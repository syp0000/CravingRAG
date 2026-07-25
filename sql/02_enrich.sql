-- ============================================================
-- 02_enrich.sql — ⭐ the core step of this project
-- Raw recipe → LLM-generated sensory "flavor profile"
-- ============================================================
-- Why this exists:
--   Embedding an ingredient list ("2 cups flour, 1 tsp salt") will never match a query
--   like "refreshing and bursting with juice". So we rewrite each document into a form
--   that IS retrievable. This is called document enrichment.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ⚠️ IMPORTANT: keep the LIMIT small on the first run.
--   7,198 rows x one LLM call each burns real credits. Validate the prompt on 20 rows,
--   then scale up once the output looks good.

CREATE OR REPLACE TABLE ENRICHED.RECIPE_PROFILES AS
SELECT
    uid,
    name,
    ingredients,

    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'You are a food writer. Describe this recipe in 2 sentences, ',
            'focusing ONLY on: taste (sweet/sour/spicy/rich), texture ',
            '(crispy/juicy/creamy/chewy), temperature, and what occasion or ',
            'mood it suits. Do NOT list ingredients or steps. ',
            'Be vivid and sensory.\n\n',
            'Recipe: ', name, '\n',
            'Ingredients: ', ingredients, '\n',
            'Description: ', COALESCE(description, '')
        )
    ) AS flavor_profile,

    CURRENT_TIMESTAMP() AS enriched_at

FROM RAW.RECIPES
LIMIT 20;          -- 👈 TODO: raise once output looks good (20 → 200 → all)


-- ------------------------------------------------------------
-- Read the output. This is where you judge prompt quality.
-- ------------------------------------------------------------
SELECT name, flavor_profile
FROM ENRICHED.RECIPE_PROFILES
LIMIT 10;

-- TODO (learning): if the profiles read flat or generic, edit the prompt above and rerun.
--   A single prompt line can noticeably change retrieval quality — this is exactly why
--   the indexing stage matters so much in RAG.
--
-- Experiments worth running:
--   1. Drop "Be vivid and sensory" — how does the output change?
--   2. Skip enrichment entirely and embed raw ingredients instead. How much worse is
--      retrieval? That measured gap is a real result you can put on your resume.
