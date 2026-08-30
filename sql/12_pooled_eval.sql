-- ============================================================
-- 12_pooled_eval.sql — W3.3: three arms, one judged pool, one ideal ranking
-- ============================================================
-- Why this file exists (outside review, 2026-08-17):
--   · The project's original claim is "sensory enrichment beats embedding raw recipes",
--     but V1 already embeds an enriched profile — there was no raw-text control arm.
--     Arm A below is that control: the SAME text the enricher saw (title + first 600
--     chars of ingredients + first 300 of directions), embedded with no LLM rewrite.
--   · sql/07's METRICS derived each arm's ideal ranking from that arm's own retrieved
--     rows, so cross-arm NDCG was measured against different yardsticks. Here the ideal
--     for a query is the best ordering of EVERY judged pair for that query, whichever arm
--     found it. One pool, one ideal, then each arm is scored against it.
--   · "Recall@5" in sql/07 divided by min(5, relevant-in-pool). That is pooled recall,
--     not corpus recall — named honestly below, with Precision@5 alongside.
--
-- Arms:  A_raw_vector   raw recipe text → arctic-embed → cosine        (control)
--        V1_baseline    LLM sensory+context profile → same embed → cosine
--        V2_structured  8-axis signals + wiki-mapped intent + hard exclusion + fallback
-- What each pairwise gap can and cannot say:
--        A → V1   the enrichment effect (same retriever, different text)
--        V1 → V2  the whole structured system vs the enriched vector — NOT an ablation:
--                 representation, parsing, scoring, exclusion, component filter and
--                 fallback all change at once. Isolating them is v3 work (docs/PLAN.md).
--
-- Judgments: EVAL2.JUDGMENTS holds every human grade with a `source` column
-- (human_W1_2026-07 = the 150 V1-pool grades; human_2026-08 = the V2-session grades).
-- The judge sees (query, title, profile) only — never which arm produced the row.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① Arm A: raw-text control. Same input the enricher received, no LLM in the loop.
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE V1.RECIPE_RAW_VECTORS AS
SELECT recipe_id, title,
       title || '\n' || LEFT(ingredients, 600) || '\n' || LEFT(directions, 300) AS raw_text,
       AI_EMBED('snowflake-arctic-embed-l-v2.0',
                title || '\n' || LEFT(ingredients, 600) || '\n' || LEFT(directions, 300)) AS raw_vec
FROM raw.curated_recipes;

ALTER TABLE EVAL2.RUNS ALTER COLUMN arm SET DATA TYPE VARCHAR(32);   -- CTAS made it VARCHAR(11)
DELETE FROM EVAL2.RUNS WHERE arm = 'A_raw_vector';
INSERT INTO EVAL2.RUNS
SELECT q.query_id, 'A_raw_vector', v.recipe_id, v.title,
       ROW_NUMBER() OVER (PARTITION BY q.query_id
                          ORDER BY VECTOR_COSINE_SIMILARITY(v.raw_vec, q.query_vec) DESC, v.recipe_id) AS rank,
       VECTOR_COSINE_SIMILARITY(v.raw_vec, q.query_vec)
FROM EVAL2.QUERY_VECTORS q CROSS JOIN V1.RECIPE_RAW_VECTORS v
QUALIFY rank <= 10;

-- ------------------------------------------------------------
-- ①-b Arm V1_excluded: V1's ranking with V2's exclusion + component filter on top.
--     The ablation the review asked for (same retriever, filters on/off) — and the
--     overall winner (NDCG@5 0.844; see eval/results_v2.md).
-- ------------------------------------------------------------
DELETE FROM EVAL2.RUNS WHERE arm = 'V1_excluded';
INSERT INTO EVAL2.RUNS
SELECT q.query_id, 'V1_excluded', v.recipe_id, v.title,
       ROW_NUMBER() OVER (PARTITION BY q.query_id
                          ORDER BY VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec) DESC, v.recipe_id) AS rank,
       VECTOR_COSINE_SIMILARITY(v.profile_vec, q.query_vec)
FROM EVAL2.QUERY_VECTORS q
JOIN V1.RECIPE_PROFILES v
JOIN V2.SEARCHABLE_RECIPES sr ON sr.recipe_id = v.recipe_id
LEFT JOIN V2.EXCLUDED_PAIRS e ON e.query_id = q.query_id AND e.recipe_id = v.recipe_id
WHERE e.recipe_id IS NULL
QUALIFY rank <= 10;

-- ------------------------------------------------------------
-- ② Every arm, one shape
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW EVAL2.ALL_RUNS AS
SELECT arm, query_id, recipe_id, title, rank FROM EVAL2.RUNS
UNION ALL
SELECT arm, query_id, recipe_id, title, rank FROM EVAL2.V2_RUNS;

-- ------------------------------------------------------------
-- ③ THE POOL TO JUDGE — blinded: no arm, no rank, no score. Ordered by query then
--    recipe_id so the order carries no signal about which system found the row.
-- ------------------------------------------------------------
SELECT a.query_id, q.query_text, a.recipe_id, a.title, LEFT(v.flavor_profile, 250) AS profile
FROM (SELECT DISTINCT query_id, recipe_id, title FROM EVAL2.ALL_RUNS) a
JOIN EVAL2.QUERIES q USING (query_id)
JOIN V1.RECIPE_PROFILES v USING (recipe_id)
LEFT JOIN EVAL2.JUDGMENTS j USING (query_id, recipe_id)
WHERE j.grade IS NULL
ORDER BY a.query_id, a.recipe_id;
-- Grades go into EVAL2.JUDGMENTS (query_id, recipe_id, grade, source). Mirror: eval/judgments.csv

-- ============================================================
-- 🛑 STOP until the pool above returns 0 rows.
-- ============================================================

-- ------------------------------------------------------------
-- ④ Metrics against the shared pool
--    relevant = grade >= 2 · unjudged pairs count as 0 (there must be none by now)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW EVAL2.METRICS_POOLED AS
WITH graded AS (
    SELECT r.arm, r.query_id, r.rank, COALESCE(j.grade, 0) AS grade
    FROM EVAL2.ALL_RUNS r LEFT JOIN EVAL2.JUDGMENTS j USING (query_id, recipe_id)
),
per_arm AS (
    SELECT arm, query_id,
           SUM(IFF(rank <= 5, (POW(2, grade) - 1) / LOG(2, rank + 1), 0)) AS dcg5,
           SUM(IFF(rank <= 5 AND grade >= 2, 1, 0))                       AS hits5
    FROM graded GROUP BY arm, query_id
),
ideal AS (   -- best ordering of ALL judged pairs for the query, whichever arm found them
    SELECT query_id,
           SUM(IFF(ideal_rank <= 5, (POW(2, grade) - 1) / LOG(2, ideal_rank + 1), 0)) AS idcg5,
           SUM(IFF(grade >= 2, 1, 0))                                                 AS pool_relevant
    FROM (SELECT query_id, grade,
                 ROW_NUMBER() OVER (PARTITION BY query_id ORDER BY grade DESC) AS ideal_rank
          FROM EVAL2.JUDGMENTS)
    GROUP BY query_id
)
SELECT p.arm, p.query_id, q.category,
       ROUND(p.dcg5 / NULLIF(i.idcg5, 0), 3)                       AS ndcg_at_5,
       ROUND(p.hits5 / 5, 3)                                       AS precision_at_5,
       ROUND(p.hits5 / NULLIF(LEAST(5, i.pool_relevant), 0), 3)    AS pooled_recall_at_5
FROM per_arm p
JOIN ideal i USING (query_id)
JOIN EVAL2.QUERIES q USING (query_id);

-- ------------------------------------------------------------
-- ⑤ Readouts → eval/results_v2.md
-- ------------------------------------------------------------
SELECT arm, ROUND(AVG(ndcg_at_5),3) AS ndcg5, ROUND(AVG(precision_at_5),3) AS p5,
       ROUND(AVG(pooled_recall_at_5),3) AS pooled_r5
FROM EVAL2.METRICS_POOLED GROUP BY arm ORDER BY ndcg5;

SELECT category, arm, ROUND(AVG(ndcg_at_5),3) AS ndcg5, ROUND(AVG(precision_at_5),3) AS p5
FROM EVAL2.METRICS_POOLED GROUP BY category, arm ORDER BY category, ndcg5;

-- Per query, wide — the failure-analysis table
SELECT query_id, category,
       MAX(IFF(arm='A_raw_vector',  ndcg_at_5, NULL)) AS a_raw,
       MAX(IFF(arm='V1_baseline',   ndcg_at_5, NULL)) AS v1,
       MAX(IFF(arm='V2_structured', ndcg_at_5, NULL)) AS v2
FROM EVAL2.METRICS_POOLED GROUP BY query_id, category ORDER BY query_id;
