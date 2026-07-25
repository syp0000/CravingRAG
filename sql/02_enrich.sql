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

-- ------------------------------------------------------------
-- ⓪ First, confirm what dlt actually created.
--    dlt lowercases identifiers, so the schema may be "raw" (quoted, lowercase)
--    rather than RAW. Run this and use whatever name you see below.
-- ------------------------------------------------------------
SHOW TABLES IN DATABASE CRAVING_RAG;
-- If the SELECT below fails with "does not exist", quote the lowercase names instead:
--    FROM "raw"."recipes"


-- ⚠️ IMPORTANT: keep the LIMIT small on the first run.
--   13.5k rows x one LLM call each burns real credits. Validate the prompt on 20 rows,
--   then scale up once the output looks good.

CREATE OR REPLACE TABLE ENRICHED.RECIPE_PROFILES AS
SELECT
    recipe_id,
    title,
    ingredients,

    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'You are a food writer. Describe this recipe in 2 sentences, ',
            'focusing ONLY on: taste (sweet/sour/spicy/rich), texture ',
            '(crispy/juicy/creamy/chewy), temperature, and what occasion or ',
            'mood it suits. Do NOT list ingredients or steps. ',
            'Be vivid and sensory.\n\n',
            'Recipe: ', title, '\n',
            'Ingredients: ', LEFT(ingredients, 800), '\n',
            -- instructions can run very long; truncate to keep token cost predictable
            'Instructions: ', LEFT(instructions, 800)
        )
    ) AS flavor_profile,

    CURRENT_TIMESTAMP() AS enriched_at

FROM RAW.RECIPES          -- 👈 if this errors, use "raw"."recipes" (see step ⓪)
LIMIT 20;                 -- 👈 TODO: raise once output looks good (20 → 200 → all)


-- ------------------------------------------------------------
-- Read the output. This is where you judge prompt quality.
-- ------------------------------------------------------------
SELECT title, flavor_profile
FROM ENRICHED.RECIPE_PROFILES
LIMIT 10;

-- TODO (learning): if the profiles read flat or generic, edit the prompt above and rerun.
--   A single prompt line can noticeably change retrieval quality — this is exactly why
--   the indexing stage matters so much in RAG.
--
-- Experiments worth running:
--   1. Drop "Be vivid and sensory" — how does the output change?
--   2. Skip enrichment entirely and embed raw ingredients instead. How much worse is
--      retrieval? That measured gap is arm A of the Phase 5 benchmark.
