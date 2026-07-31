-- ============================================================
-- 07_eval_baseline.sql — W1.6/W1.7: judge the V1 baseline, compute the number
-- ============================================================
-- ⚠️ DO NOT "Run All". This file spans the manual judging step:
--     ① ② ③   build query set, vectors, pool     → run now
--     ④        export the pool                    → run, download CSV, judge it
--     ─────── you fill EVAL2.JUDGMENTS by hand (grades 0-3) ───────
--     ⑤ ⑥     metrics                             → empty until judgments exist
--
-- Fresh schema EVAL2 on purpose: the old EVAL tables hold the v1-era pool that
-- DESIGN §7's hub numbers came from. They stay untouched.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE SCHEMA IF NOT EXISTS EVAL2;

-- ------------------------------------------------------------
-- ① The frozen query set (mirrors eval/queries.yml, 2026-07-31)
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL2.QUERIES (query_id STRING, query_text STRING, category STRING);
INSERT INTO EVAL2.QUERIES VALUES
    ('q01', 'spicy warm soup',                        'sensory'),
    ('q02', 'refreshing juicy dish',                  'sensory'),
    ('q03', 'rich comforting meal',                   'sensory'),
    ('q04', 'crispy on the outside, tender inside',   'sensory'),
    ('q05', 'light and clean, nothing heavy',         'sensory'),
    ('q06', 'savory noodle soup',                     'sensory'),
    ('q07', 'cozy dinner for a cold day',             'occasion'),
    ('q08', 'quick casual lunch',                     'occasion'),
    ('q09', 'sweet treat for a celebration',          'occasion'),
    ('q10', 'summer picnic food',                     'occasion'),
    ('q11', 'something cold for a hot day',           'occasion'),
    ('q12', 'spicy dish without peanuts',             'exclusion'),
    ('q13', 'comforting dessert without almonds',     'exclusion'),
    ('q14', 'warm soup with no shellfish',            'exclusion'),
    ('q15', 'rich chocolate dessert',                 'constraint');

-- ------------------------------------------------------------
-- ② Embed queries ONCE (never inside the join — 15 calls, not 15 x 342)
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL2.QUERY_VECTORS AS
SELECT query_id, query_text, category,
       AI_EMBED('snowflake-arctic-embed-l-v2.0', query_text) AS query_vec
FROM EVAL2.QUERIES;

-- ------------------------------------------------------------
-- ③ V1 baseline runs: top 10 per query by cosine
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL2.RUNS AS
SELECT
    q.query_id,
    'V1_baseline' AS arm,
    v.recipe_id,
    v.title,
    ROW_NUMBER() OVER (
        PARTITION BY q.query_id
        ORDER BY VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec) DESC
    ) AS rank,
    VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec) AS similarity
FROM EVAL2.QUERY_VECTORS q
CROSS JOIN V1.RECIPE_PROFILES v
QUALIFY rank <= 10;

-- ------------------------------------------------------------
-- ④ THE POOL TO JUDGE — run this, download as CSV
-- ------------------------------------------------------------
-- Add a `grade` column (0-3) per eval/JUDGING.md, then load back into EVAL2.JUDGMENTS.
-- 15 queries x 10 = 150 rows. Sorted so one query judges in one sweep.
SELECT
    r.query_id,
    q.query_text,
    r.recipe_id,
    r.title,
    LEFT(v.flavor_profile, 250) AS profile
FROM EVAL2.RUNS r
JOIN EVAL2.QUERIES q USING (query_id)
JOIN V1.RECIPE_PROFILES v USING (recipe_id)
ORDER BY r.query_id, r.rank;

CREATE TABLE IF NOT EXISTS EVAL2.JUDGMENTS (
    query_id  STRING,
    recipe_id NUMBER,
    grade     NUMBER      -- 0-3; exclusion violations are an automatic 0
);
-- Load the judged CSV here (Snowsight: EVAL2.JUDGMENTS → Load Data).
-- Keep only query_id, recipe_id, grade columns when loading.

-- ============================================================
-- 🛑 STOP until EVAL2.JUDGMENTS has 150 rows.
--    Check:  SELECT COUNT(*) FROM EVAL2.JUDGMENTS;
-- ============================================================

-- ------------------------------------------------------------
-- ⑤ NDCG@5 and Recall@5 per query
--    relevant (for recall) = grade >= 2 ("good or better" — stated in the README)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW EVAL2.METRICS AS
WITH graded AS (
    SELECT r.arm, r.query_id, r.rank, COALESCE(j.grade, 0) AS grade
    FROM EVAL2.RUNS r
    LEFT JOIN EVAL2.JUDGMENTS j USING (query_id, recipe_id)
),
dcg AS (
    SELECT arm, query_id,
           SUM(IFF(rank <= 5, (POW(2, grade) - 1) / LOG(2, rank + 1), 0)) AS dcg5,
           SUM(IFF(rank <= 5 AND grade >= 2, 1, 0))                       AS hits5
    FROM graded GROUP BY arm, query_id
),
ideal AS (   -- best possible ordering of the grades we actually judged for that query
    SELECT arm, query_id,
           SUM(IFF(ideal_rank <= 5, (POW(2, grade) - 1) / LOG(2, ideal_rank + 1), 0)) AS idcg5,
           SUM(IFF(grade >= 2, 1, 0))                                                 AS total_relevant
    FROM (SELECT arm, query_id, grade,
                 ROW_NUMBER() OVER (PARTITION BY arm, query_id ORDER BY grade DESC) AS ideal_rank
          FROM graded)
    GROUP BY arm, query_id
)
SELECT d.arm, d.query_id, q.category,
       ROUND(d.dcg5 / NULLIF(i.idcg5, 0), 3)                         AS ndcg_at_5,
       ROUND(d.hits5 / NULLIF(LEAST(5, i.total_relevant), 0), 3)     AS recall_at_5
FROM dcg d
JOIN ideal i USING (arm, query_id)
JOIN EVAL2.QUERIES q USING (query_id);

-- ------------------------------------------------------------
-- ⑥ The baseline numbers → eval/results_baseline.md
-- ------------------------------------------------------------
SELECT arm, ROUND(AVG(ndcg_at_5), 3) AS mean_ndcg5, ROUND(AVG(recall_at_5), 3) AS mean_recall5
FROM EVAL2.METRICS GROUP BY arm;

-- Per category — exclusion is the row that matters most; it is expected to be the worst.
SELECT arm, category, ROUND(AVG(ndcg_at_5), 3) AS ndcg5, ROUND(AVG(recall_at_5), 3) AS recall5
FROM EVAL2.METRICS GROUP BY arm, category ORDER BY ndcg5;

-- Worst queries → future failure-analysis section
SELECT query_id, category, ndcg_at_5, recall_at_5
FROM EVAL2.METRICS ORDER BY ndcg_at_5 LIMIT 5;
