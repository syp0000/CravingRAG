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
-- If a query returns poor results, that is a signal to improve the prompt in 02_enrich.sql,
-- not the search query itself.


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
