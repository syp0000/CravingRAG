-- ============================================================
-- 04_search.sql — the R (Retrieval) and G (Generation) of RAG
-- ============================================================
-- This is the highlight of the project: RAG working end to end
-- with no UI at all, just SQL.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① RETRIEVAL — find the Top-K recipes closest to the query
-- ------------------------------------------------------------
SET user_query = 'something refreshing and bursting with juice';

SELECT
    title,
    flavor_profile,
    VECTOR_COSINE_SIMILARITY(
        profile_vec,
        AI_EMBED('snowflake-arctic-embed-l-v2.0', $user_query)
    ) AS similarity
FROM SEARCH.RECIPE_VECTORS
ORDER BY similarity DESC
LIMIT 10;

-- 👆 That is the entire "R" in RAG. Simpler than expected:
--    embed the query with the SAME model → sort by cosine similarity → take the top K.


-- ------------------------------------------------------------
-- ② GENERATION — explain the results, grounded in what was retrieved
-- ------------------------------------------------------------
-- The point of RAG: the model answers only from the recipes we actually retrieved,
-- instead of inventing them. This is called grounding.

WITH top_recipes AS (
    SELECT
        title,
        flavor_profile,
        VECTOR_COSINE_SIMILARITY(
            profile_vec,
            AI_EMBED('snowflake-arctic-embed-l-v2.0', $user_query)
        ) AS similarity
    FROM SEARCH.RECIPE_VECTORS
    ORDER BY similarity DESC
    LIMIT 5
),
context AS (
    SELECT LISTAGG(CONCAT('- ', title, ': ', flavor_profile), '\n') AS retrieved_context
    FROM top_recipes
)
SELECT
    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'The user wants: "', $user_query, '"\n\n',
            'Here are the retrieved recipe candidates:\n', retrieved_context, '\n\n',
            'Pick the 3 best matches and explain in one sentence each why they fit ',
            'the request. Use ONLY recipes from the list above. Do not invent recipes.'
        )
    ) AS recommendation
FROM context;

-- 👆 "Do not invent recipes" is the anti-hallucination guardrail.
--    Grounding like this is precisely why RAG beats a bare LLM for this task.


-- ------------------------------------------------------------
-- TODO (learning): try a range of queries
-- ------------------------------------------------------------
-- SET user_query = 'warm comforting broth for a hangover';
-- SET user_query = 'cozy and hearty for a rainy day';
-- SET user_query = 'light palate cleanser after something greasy';
-- SET user_query = '상큼하고 과즙이 터지는';   -- cross-lingual: Korean query, English corpus
--
-- ------------------------------------------------------------
-- 🔍 BEFORE BLAMING RETRIEVAL: does the corpus even contain an answer?
-- ------------------------------------------------------------
-- A bad result has two very different causes, and they look identical from the outside:
--   (a) retrieval failed to find a dish that was there   → fix embeddings/prompt
--   (b) no suitable dish was ever enriched               → fix the corpus
--
-- Always check (b) first. It is cheaper to check and more often the cause.
--
-- This happened on the first real run: '해장되는 뜨끈한 국물' returned vindaloo and a cold
-- slaw. It looked like broken cross-lingual retrieval. It was not — only ~14% of world
-- dishes had been enriched, so of 15 Korean soups in the corpus roughly 2 existed as
-- vectors. There was nothing to find.

-- How many dishes of the relevant kind actually made it into the index?
SELECT source, COUNT(*) AS enriched_dishes
FROM SEARCH.RECIPE_VECTORS
GROUP BY source;

-- Look for candidates by keyword, independent of the vector search. If this returns
-- nothing, the query cannot possibly succeed and the prompt is not the problem.
SELECT title, LEFT(flavor_profile, 120) AS profile
FROM SEARCH.RECIPE_VECTORS
WHERE flavor_profile ILIKE '%broth%'
   OR flavor_profile ILIKE '%soup%'
   OR flavor_profile ILIKE '%stew%'
LIMIT 20;

-- ------------------------------------------------------------
-- 🪜 ISOLATION LADDER — run these in order when a query disappoints
-- ------------------------------------------------------------
-- '해장되는 뜨끈한 국물' failing tells you almost nothing on its own, because three
-- different things could cause it. Change one variable at a time instead:
--
--   1. 'hot noodle soup'              plain English, plain dish type
--        fails → the indexed text does not describe dish types. Fix 02_enrich.
--        works → go to 2.
--
--   2. 'warm broth to cure a hangover'  English, but an abstract concept
--        fails → "hangover" is not expressible from the source data; no profile
--                 will ever mention it. Narrow the query or accept the limit.
--        works → go to 3.
--
--   3. '해장되는 뜨끈한 국물'            the original
--        fails → genuinely a cross-lingual gap. Cross-lingual pairs already score
--                 ~0.09 lower at equal meaning, so this is plausible.
--
-- Whichever step first fails is the one to fix. Do not tune more than one at a time.
SET user_query = 'hot noodle soup';                    -- step 1
-- SET user_query = 'warm broth to cure a hangover';   -- step 2
-- SET user_query = '해장되는 뜨끈한 국물';               -- step 3

-- Also worth knowing: "hot" is ambiguous in English (temperature vs spicy), which is
-- why hot sauces and vindaloo rank for a query about warm broth. If step 1 works but
-- results skew spicy, try 'warm comforting noodle soup' — a wording that cannot be
-- read as spicy — to confirm that is what is happening.

-- ------------------------------------------------------------
-- If a query returns poor results AND the corpus does contain good candidates, THEN it
-- is a signal to improve the prompt in 02_enrich.sql — not the search query itself.


-- ------------------------------------------------------------
-- TODO (Phase 5): upgrade to hybrid search
-- ------------------------------------------------------------
-- Weakness of pure vector search: it misses exact terms ("kimchi", "under 30 minutes").
-- Cortex Search combines vector similarity with keyword (BM25) matching.
--
-- CREATE CORTEX SEARCH SERVICE recipe_search
--   ON flavor_profile
--   ATTRIBUTES title, ingredients
--   WAREHOUSE = CRAVING_WH
--   TARGET_LAG = '1 day'
--   AS SELECT recipe_id, title, ingredients, flavor_profile FROM SEARCH.RECIPE_VECTORS;
--
-- Then benchmark it against query ① above. That comparison is the number for your resume.
