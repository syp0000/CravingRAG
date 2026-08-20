-- ============================================================
-- 13_catalog_insights.sql — the business side of the sensory data model
-- ============================================================
-- The reframe (Siyeon, 2026-08-19): the constellation answers "what should I eat?" —
-- these queries answer "what does our catalog actually offer?" from the SAME tables.
-- Cortex extracted the axes from unstructured recipe text (sql/08); here they behave
-- like any other analyzable dimension. That — not the LLM call — is the Snowflake story.
--
-- Every number below is REAL (catalog + extraction). No behavioral data exists in this
-- project and none is simulated here; the synthetic-events demo lives in sql/14 and is
-- labeled as such. Run after the 20k enrichment; numbers in comments are from the
-- 342-recipe corpus where noted.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① Where is the catalog crowded, where is it thin?
--    A dish "offers" an axis when its extracted value ≥ 0.6.
-- ------------------------------------------------------------
SELECT s.key AS axis,
       COUNT(*)                                          AS dishes_offering,
       ROUND(100 * COUNT(*) / (SELECT COUNT(*) FROM V2.RECIPE_SIGNALS), 1) AS pct_of_catalog
FROM V2.RECIPE_SIGNALS, LATERAL FLATTEN(input => signals) s
WHERE s.value::float >= 0.6
GROUP BY s.key ORDER BY dishes_offering DESC;

-- ------------------------------------------------------------
-- ② Craving COMBINATIONS: supply for two-axis demands.
--    "We have strong demand for fresh + spicy — how much of the catalog satisfies it?"
-- ------------------------------------------------------------
WITH pairs AS (
    SELECT a.key AS axis1, b.key AS axis2, r.recipe_id
    FROM V2.RECIPE_SIGNALS r,
         LATERAL FLATTEN(input => r.signals) a,
         LATERAL FLATTEN(input => r.signals) b
    WHERE a.key < b.key AND a.value::float >= 0.6 AND b.value::float >= 0.6
)
SELECT axis1, axis2, COUNT(*) AS dishes,
       ROUND(100 * COUNT(*) / (SELECT COUNT(*) FROM V2.RECIPE_SIGNALS), 1) AS pct
FROM pairs GROUP BY axis1, axis2 ORDER BY dishes DESC;
-- 342-corpus finding: savory+warm dominates; fresh+spicy and fresh+sweet are thin —
-- the "refreshing" craving family is underserved relative to comfort food.

-- ------------------------------------------------------------
-- ③ Allergen exposure: how much of the catalog does one exclusion erase?
--    (substring + alias rule, same as retrieval — V2.EXCLUSION_ALIASES)
-- ------------------------------------------------------------
WITH hay AS (
    SELECT recipe_id, LOWER(COALESCE(title,'')||' '||COALESCE(ingredients,'')||' '||COALESCE(ner,'')) AS h
    FROM raw.curated_recipes
),
terms AS (SELECT * FROM VALUES ('shellfish'),('peanut'),('almond'),('dairy_milk') t(term)),
needles AS (
    SELECT term, term AS needle FROM terms WHERE term <> 'dairy_milk'
    UNION ALL SELECT 'dairy_milk', v.needle FROM (VALUES ('milk'),('butter'),('cream'),('cheese')) v(needle)
    UNION ALL SELECT canonical_term, alias FROM V2.EXCLUSION_ALIASES
)
SELECT n.term,
       COUNT(DISTINCT h.recipe_id) AS dishes_removed,
       ROUND(100 * COUNT(DISTINCT h.recipe_id) / (SELECT COUNT(*) FROM hay), 1) AS pct_of_catalog
FROM needles n JOIN hay h ON h.h LIKE '%' || n.needle || '%'
GROUP BY n.term ORDER BY dishes_removed DESC;
-- The menu-planning readout: "a dairy-free customer loses X% of this catalog."

-- ------------------------------------------------------------
-- ④ Extraction health: which axes are usable as dimensions at scale?
--    NULL = the model found no evidence (by design). An axis that is NULL for most of
--    the catalog cannot serve as a business dimension yet.
-- ------------------------------------------------------------
SELECT a.axis,
       COUNT_IF(GET(r.signals, a.axis) IS NOT NULL) AS measured,
       COUNT(*) AS corpus,
       ROUND(100 * COUNT_IF(GET(r.signals, a.axis) IS NOT NULL) / COUNT(*), 1) AS pct_measured
FROM V2.RECIPE_SIGNALS r
CROSS JOIN (SELECT * FROM VALUES ('spicy'),('warm'),('brothy'),('savory'),
                                 ('rich'),('fresh'),('sweet'),('comforting') a(axis)) a
GROUP BY a.axis ORDER BY pct_measured DESC;

-- ------------------------------------------------------------
-- ⑤ Demand vs supply, using the 15 eval cravings as a demand proxy.
--    Candidate count per craving (post-filter) = how well the catalog serves it.
--    Honest label: these queries are a dev set, not market demand — the point is the
--    SHAPE of the question, which real query logs would answer the same way.
-- ------------------------------------------------------------
SELECT q.query_text                        AS craving,
       COUNT(DISTINCT e.recipe_id)         AS supply,
       ROUND(AVG(e.axis_score), 2)         AS avg_fit
FROM EVAL2.QUERIES q LEFT JOIN EVAL2.V2_EDGES e USING (query_id)
GROUP BY q.query_id, q.query_text ORDER BY supply;
