-- ============================================================
-- 08_v2_signals.sql — W2.1: structured sensory signals per recipe
-- ============================================================
-- Schema shape was settled by testing against live AI_COMPLETE first:
--   · a large nested {signals:{8 props}, evidence:{8 arrays}} schema silently returns
--     NULL — an array of {axis, value, evidence} objects generates reliably
--   · `evidence` is REQUIRED per entry, so "no evidence → axis absent" is enforced by
--     the schema itself; an absent axis reads back as NULL (DECISIONS §5, for free)
--   · the value range must be stated in the prompt — without "0.0-1.0" the model
--     returned 7
--
-- Model stays mistral-large2: V1 used it, so the LLM is held constant and the V1-vs-V2
-- delta attributes to the representation, not the model.
--
-- ⚠️ Run in order. ① is a 20-row prompt check — do not run ③ until ② looks right.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE SCHEMA IF NOT EXISTS V2;

-- ------------------------------------------------------------
-- ① Raw responses, 20-row test batch first (v1 lesson: validate before scaling)
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE V2.SIGNALS_RAW AS
SELECT
    recipe_id, title, cuisine, pattern,
    PARSE_JSON(AI_COMPLETE(
        model => 'mistral-large2',
        prompt => CONCAT(
            'Rate this dish on sensory axes: spicy, warm, brothy, savory, rich, fresh, ',
            'sweet, comforting.\n',
            'Include an axis ONLY if the ingredients or method below give concrete ',
            'evidence for it — omit unsupported axes entirely. Do not guess.\n',
            'value: 0.0 to 1.0. evidence: the exact ingredient or method words that ',
            'justify the value, copied from the text below.\n',
            'warm means served hot; fresh means bright/raw/citrusy; rich means heavy ',
            'or fatty.\n\n',
            'Dish: ', title, '\n',
            'Ingredients: ', LEFT(ingredients, 600), '\n',
            'Method: ', LEFT(directions, 300)
        ),
        model_parameters => {'max_tokens': 1200},
        response_format => {
            'type': 'json',
            'schema': {'type':'object','properties':{
                'axes':{'type':'array','items':{'type':'object','properties':{
                    'axis':{'type':'string',
                            'enum':['spicy','warm','brothy','savory','rich','fresh','sweet','comforting']},
                    'value':{'type':'number'},
                    'evidence':{'type':'array','items':{'type':'string'}}},
                    'required':['axis','value','evidence']}}},
                'required':['axes']}
        }
    )) AS resp
FROM raw.curated_recipes
LIMIT 20;                      -- 👈 ③ removes this

-- ------------------------------------------------------------
-- ② Inspect the test batch — READ THESE before scaling
-- ------------------------------------------------------------
-- Values in range? Evidence words actually from the ingredients? Unsupported axes absent?
SELECT title,
       f.value:axis::string    AS axis,
       f.value:value::float    AS value,
       f.value:evidence        AS evidence
FROM V2.SIGNALS_RAW, LATERAL FLATTEN(input => resp:axes) f
ORDER BY title, axis;

-- Failure scan: NULL responses or empty evidence arrays (schema should prevent both)
SELECT COUNT(*) AS null_responses FROM V2.SIGNALS_RAW WHERE resp IS NULL;
SELECT COUNT(*) AS empty_evidence
FROM V2.SIGNALS_RAW, LATERAL FLATTEN(input => resp:axes) f
WHERE ARRAY_SIZE(f.value:evidence) = 0;

-- ------------------------------------------------------------
-- ③ Looks good? Re-run ① WITHOUT the LIMIT (342 rows, one call each — cheaper than
--    V1 enrichment, which took two calls per recipe). Then continue below.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- ③-b RETRY transient failures. On the first full run 14 of 342 responses came back
--     NULL — sporadic AI_COMPLETE failures, unrelated to input length, and the casualties
--     included Pad Thai (q12's exclusion target) and Basic Vegetarian Pho (q06).
--     Delete the NULLs and regenerate just those rows. Repeat until the count is 0.
-- ------------------------------------------------------------
DELETE FROM V2.SIGNALS_RAW WHERE resp IS NULL;

INSERT INTO V2.SIGNALS_RAW
SELECT
    recipe_id, title, cuisine, pattern,
    PARSE_JSON(AI_COMPLETE(
        model => 'mistral-large2',
        prompt => CONCAT(
            'Rate this dish on sensory axes: spicy, warm, brothy, savory, rich, fresh, ',
            'sweet, comforting.\n',
            'Include an axis ONLY if the ingredients or method below give concrete ',
            'evidence for it — omit unsupported axes entirely. Do not guess.\n',
            'value: 0.0 to 1.0. evidence: the exact ingredient or method words that ',
            'justify the value, copied from the text below.\n',
            'evidence must be words from the Ingredients or Method lines only — ',
            'never the dish name itself.\n',
            'warm means served hot; fresh means bright/raw/citrusy; rich means heavy, ',
            'creamy, or indulgent (butter, cream, fatty meat) — a small amount of oil ',
            'or nuts in an otherwise light dish is not rich.\n\n',
            'Dish: ', title, '\n',
            'Ingredients: ', LEFT(ingredients, 600), '\n',
            'Method: ', LEFT(directions, 300)
        ),
        model_parameters => {'max_tokens': 1200},
        response_format => {
            'type': 'json',
            'schema': {'type':'object','properties':{
                'axes':{'type':'array','items':{'type':'object','properties':{
                    'axis':{'type':'string',
                            'enum':['spicy','warm','brothy','savory','rich','fresh','sweet','comforting']},
                    'value':{'type':'number'},
                    'evidence':{'type':'array','items':{'type':'string'}}},
                    'required':['axis','value','evidence']}}},
                'required':['axes']}
        }
    )) AS resp
FROM raw.curated_recipes
WHERE recipe_id NOT IN (SELECT recipe_id FROM V2.SIGNALS_RAW);

SELECT COUNT(*) AS remaining_nulls FROM V2.SIGNALS_RAW WHERE resp IS NULL;
-- > 0 → run ③-b again. 0 → continue.

-- ------------------------------------------------------------
-- ④ Final table: pivot the array into signals/evidence objects for easy access
--    signals:spicy::float  → 0.8, or NULL when the axis was omitted
-- ------------------------------------------------------------
-- Two fixes the first full run forced:
--   · WHERE ARRAY_SIZE(evidence) > 0 — the JSON schema's `required` only guarantees the
--     key exists; [] satisfies it. 6 entries arrived with empty evidence. Dropping them
--     here turns those axes into NULL, which is exactly the §5 contract.
--   · LEFT JOIN from the corpus — the old inner FLATTEN silently dropped any recipe
--     whose response failed, making 14 recipes unretrievable ghosts. Every corpus row
--     must exist here even if its signals are NULL (the vector fallback still covers it).
CREATE OR REPLACE TABLE V2.RECIPE_SIGNALS AS
WITH agg AS (
    SELECT
        r.recipe_id,
        OBJECT_AGG(f.value:axis::string, f.value:value)    AS signals,
        OBJECT_AGG(f.value:axis::string, f.value:evidence) AS evidence,
        MAX(r.resp)                                        AS raw_response
    FROM V2.SIGNALS_RAW r, LATERAL FLATTEN(input => r.resp:axes) f
    WHERE ARRAY_SIZE(f.value:evidence) > 0
    GROUP BY r.recipe_id
)
SELECT
    c.recipe_id, c.title, c.cuisine, c.pattern,
    a.signals, a.evidence, a.raw_response,
    CURRENT_TIMESTAMP() AS created_at
FROM raw.curated_recipes c
LEFT JOIN agg a USING (recipe_id);

-- ------------------------------------------------------------
-- ⑤ Done-when checks
-- ------------------------------------------------------------
SELECT COUNT(*) AS rows_expected_342 FROM V2.RECIPE_SIGNALS;

-- W2.1's contract: no axis value without evidence (schema enforces; verify anyway)
SELECT COUNT(*) AS value_without_evidence
FROM V2.RECIPE_SIGNALS, LATERAL FLATTEN(input => signals) s
WHERE evidence[s.key] IS NULL OR ARRAY_SIZE(evidence[s.key]) = 0;
-- must be 0

-- NULL-by-omission working? (kimchi jjigae: fresh should be NULL, spicy should not)
SELECT title, signals:spicy::float AS spicy, signals:fresh::float AS fresh, signals
FROM V2.RECIPE_SIGNALS WHERE pattern = 'kimchi jjigae';

-- Axis coverage: how often is each axis measured vs NULL? (feeds the W4 writeup)
SELECT s.key AS axis, COUNT(*) AS measured, 342 - COUNT(*) AS null_rows
FROM V2.RECIPE_SIGNALS, LATERAL FLATTEN(input => signals) s
GROUP BY s.key ORDER BY measured DESC;
