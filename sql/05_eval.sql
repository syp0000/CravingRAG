-- ============================================================
-- 05_eval.sql — Phase 5: measure retrieval quality
-- ============================================================
-- This is the phase that separates "I built a RAG app" from "I measured retrieval
-- quality and can defend the design". Run it only once the pipeline has stopped
-- changing — an evaluation of a moving target has to be redone.
--
-- METHOD: pooled relevance judgment.
--   Labelling which of 2,000+ dishes are relevant to each query is impossible by hand.
--   Instead, run every arm, pool their top-10 results, and judge only the pool — about
--   30 dishes per query instead of 2,000. This is what TREC and other IR benchmarks do.
--   It is not perfect (a relevant dish no arm retrieved is never judged, so recall is
--   measured relative to the pool), and that limitation belongs in the README.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE SCHEMA IF NOT EXISTS EVAL;

-- ------------------------------------------------------------
-- ① The query set. Mirrors eval/queries.yml.
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL.QUERIES (
    query_id  STRING,
    query_text STRING,
    category  STRING          -- sensory | occasion | constraint | cross_lingual
);

INSERT INTO EVAL.QUERIES VALUES
    ('q01', 'something refreshing and bursting with juice', 'sensory'),
    ('q02', 'rich creamy and indulgent',                    'sensory'),
    ('q03', 'crispy on the outside, tender inside',         'sensory'),
    ('q04', 'spicy enough to make me sweat',                'sensory'),
    ('q05', 'light and clean, nothing heavy',               'sensory'),
    ('q06', 'warm and comforting, like a hug',              'sensory'),
    ('q07', 'cozy dinner for a cold rainy day',             'occasion'),
    ('q08', 'warm broth to cure a hangover',                'occasion'),
    ('q09', 'impressive but easy dish for guests',          'occasion'),
    ('q10', 'quick lunch I can eat at my desk',             'occasion'),
    ('q11', 'palate cleanser after something greasy',       'occasion'),
    ('q12', 'summer picnic food that travels well',         'occasion'),
    ('q13', 'vegetarian, no meat at all',                   'constraint'),
    ('q14', 'ready in under 30 minutes',                    'constraint'),
    ('q15', 'no oven required',                             'constraint'),
    ('q16', 'chocolate dessert',                            'constraint'),
    ('q17', '상큼하고 과즙이 터지는',                          'cross_lingual'),
    ('q18', '해장되는 뜨끈한 국물',                            'cross_lingual'),
    ('q19', '비 오는 날 어울리는 따뜻한 음식',                   'cross_lingual'),
    ('q20', '느끼한 거 먹고 난 다음 입가심',                     'cross_lingual');


-- ------------------------------------------------------------
-- ② Embed the queries ONCE.
-- ------------------------------------------------------------
-- Do not call AI_EMBED inside the join below. The query text only takes 20 distinct
-- values, but inlined into a cross join against ~6,000 dishes the optimizer may
-- evaluate it per row — 120,000 embedding calls instead of 20. Materialize first.
CREATE OR REPLACE TABLE EVAL.QUERY_VECTORS AS
SELECT
    query_id,
    query_text,
    category,
    AI_EMBED('snowflake-arctic-embed-l-v2.0', query_text) AS query_vec
FROM EVAL.QUERIES;


-- ------------------------------------------------------------
-- ③ Build the pool: top 10 per query, per arm.
-- ------------------------------------------------------------
-- Start with the arm you have (B). Add rows for A / C / D as you build them by
-- re-running this against a different vector table and changing the arm label.
CREATE OR REPLACE TABLE EVAL.RUNS AS
SELECT
    q.query_id,
    'B_enriched_vector'  AS arm,
    v.dish_id,
    v.title,
    ROW_NUMBER() OVER (
        PARTITION BY q.query_id
        ORDER BY VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec) DESC
    ) AS rank,
    VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec) AS similarity
FROM EVAL.QUERY_VECTORS q
CROSS JOIN SEARCH.RECIPE_VECTORS v
QUALIFY rank <= 10;


-- ------------------------------------------------------------
-- ④ The pool to judge. THIS IS THE MANUAL PART.
-- ------------------------------------------------------------
-- Export this, add a `relevant` column (1 or 0), and load it back into EVAL.JUDGMENTS.
-- Deduplicated across arms, so a dish retrieved by three arms is judged once.
SELECT DISTINCT
    r.query_id,
    q.query_text,
    r.dish_id,
    r.title,
    LEFT(v.flavor_profile, 200) AS profile
FROM EVAL.RUNS r
JOIN EVAL.QUERIES q USING (query_id)
JOIN SEARCH.RECIPE_VECTORS v USING (dish_id)
ORDER BY r.query_id, r.title;

-- Judge with one question, consistently: "if I asked for this, would I be happy to be
-- shown this dish?" Not "is it the best" — just acceptable or not. Binary. Do not
-- overthink borderline cases; be consistent instead of correct, and note your rule in
-- the README (e.g. "a drink counts for 'refreshing' queries").


CREATE TABLE IF NOT EXISTS EVAL.JUDGMENTS (
    query_id STRING,
    dish_id  STRING,
    relevant INT          -- 1 = acceptable answer, 0 = not
);
-- Load your judged rows here (Snowsight: table → Load Data, from CSV).


-- ------------------------------------------------------------
-- ⑤ Recall@5 — the headline metric
-- ------------------------------------------------------------
-- Recall@5 = relevant dishes in the top 5 / min(5, total relevant known for that query)
CREATE OR REPLACE VIEW EVAL.RECALL_AT_5 AS
WITH relevant_counts AS (
    SELECT query_id, SUM(relevant) AS total_relevant
    FROM EVAL.JUDGMENTS
    GROUP BY query_id
),
hits AS (
    SELECT r.arm, r.query_id, SUM(COALESCE(j.relevant, 0)) AS hits_in_top5
    FROM EVAL.RUNS r
    LEFT JOIN EVAL.JUDGMENTS j
           ON j.query_id = r.query_id AND j.dish_id = r.dish_id
    WHERE r.rank <= 5
    GROUP BY r.arm, r.query_id
)
SELECT
    h.arm,
    h.query_id,
    q.category,
    h.hits_in_top5,
    c.total_relevant,
    h.hits_in_top5 / NULLIF(LEAST(5, c.total_relevant), 0) AS recall_at_5
FROM hits h
JOIN relevant_counts c USING (query_id)
JOIN EVAL.QUERIES q USING (query_id);


-- ------------------------------------------------------------
-- ⑥ The results to report
-- ------------------------------------------------------------
-- Headline: one number per arm
SELECT arm, ROUND(AVG(recall_at_5), 3) AS mean_recall_at_5
FROM EVAL.RECALL_AT_5
GROUP BY arm
ORDER BY mean_recall_at_5 DESC;

-- By category — this is where the story is. The average hides it.
-- Expect cross_lingual to lag: measured separately, Korean/English pairs of equal
-- meaning score ~0.09 lower in cosine similarity than English/English pairs.
SELECT arm, category, ROUND(AVG(recall_at_5), 3) AS recall_at_5
FROM EVAL.RECALL_AT_5
GROUP BY arm, category
ORDER BY arm, category;

-- Worst queries — these become the "failure cases" section of the README, which is the
-- part that reads as senior. Being able to say where your own system breaks, and why,
-- is worth more than a good average.
SELECT arm, query_id, category, recall_at_5
FROM EVAL.RECALL_AT_5
ORDER BY recall_at_5 ASC, arm
LIMIT 10;
