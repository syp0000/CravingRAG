-- ============================================================
-- 02_enrich.sql — ⭐ the core step of this project
-- Raw recipe → LLM-generated sensory "flavor profile"
-- ============================================================
-- Why this exists:
--   Embedding an ingredient list ("2 cups flour, 1 tsp salt") will never match a query
--   like "refreshing and bursting with juice". So we rewrite each document into a form
--   that IS retrievable. This is called document enrichment.
--
-- Two sources are unioned here, not at ingestion:
--   raw.recipes      — Epicurious, has ingredients + instructions (mostly Western)
--   raw.world_dishes — Wikipedia world cuisine, has a description (global coverage)
--   Keeping RAW faithful to each source and reshaping downstream is the medallion
--   pattern: raw stays as-loaded, ENRICHED is where the shapes are reconciled.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ⓪ Confirm what dlt actually created. dlt lowercases identifiers, so the schema
--    may be "raw" rather than RAW. Use whatever names you see here.
-- ------------------------------------------------------------
SELECT table_schema, table_name, row_count
FROM CRAVING_RAG.INFORMATION_SCHEMA.TABLES
WHERE table_name ILIKE ANY ('RECIPES', 'WORLD_DISHES');


-- ⚠️ IMPORTANT: keep the LIMIT small on the first run.
--   Every row costs one LLM call. Validate the prompt on 20 rows before scaling up.

CREATE OR REPLACE TABLE ENRICHED.RECIPE_PROFILES AS
WITH all_dishes AS (

    -- Epicurious recipes: rich detail (ingredients + how it is made)
    SELECT
        'ep-' || recipe_id::STRING              AS dish_id,
        title,
        'epicurious'                            AS source,
        NULL                                    AS cuisine,
        'Ingredients: ' || LEFT(ingredients, 700)
            || '\nInstructions: ' || LEFT(instructions, 700)  AS detail
    FROM raw.recipes                    -- 👈 adjust case if step ⓪ shows otherwise

    UNION ALL

    -- World cuisine: a description instead of a recipe. Still enough to write a
    -- flavor profile from, and it is what gives the corpus non-Western coverage.
    SELECT
        dish_id,
        title,
        'worldcuisines'                         AS source,
        cuisines                                AS cuisine,
        'About this dish: ' || LEFT(description, 1000)        AS detail
    FROM raw.world_dishes
)
SELECT
    dish_id,
    title,
    source,
    cuisine,
    detail,

    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'You are a food writer. Describe this dish in 2 sentences, ',
            'focusing ONLY on: taste (sweet/sour/spicy/rich), texture ',
            '(crispy/juicy/creamy/chewy), temperature, and what occasion or ',
            'mood it suits. Do NOT list ingredients or steps. ',
            'Be vivid and sensory.\n\n',
            'Dish: ', title, '\n',
            detail
        )
    ) AS flavor_profile,

    CURRENT_TIMESTAMP() AS enriched_at

FROM all_dishes
-- Sample both sources rather than taking the first N rows, which would be all
-- Epicurious and would not exercise the cross-lingual queries at all.
QUALIFY ROW_NUMBER() OVER (PARTITION BY source ORDER BY RANDOM()) <= 10;
-- 👆 10 per source = 20 rows. TODO: raise once the output looks good.


-- ------------------------------------------------------------
-- Read the output. This is where you judge prompt quality.
-- ------------------------------------------------------------
SELECT source, cuisine, title, flavor_profile
FROM ENRICHED.RECIPE_PROFILES
ORDER BY source
LIMIT 20;

-- Sanity check: both sources present?
SELECT source, COUNT(*) FROM ENRICHED.RECIPE_PROFILES GROUP BY source;

-- TODO (learning): if the profiles read flat or generic, edit the prompt above and rerun.
--   A single prompt line can noticeably change retrieval quality — this is exactly why
--   the indexing stage matters so much in RAG.
--
-- Experiments worth running:
--   1. Drop "Be vivid and sensory" — how does the output change?
--   2. Do worldcuisines profiles come out weaker than Epicurious ones? They start from
--      less detail, so they may. If so, that is worth reporting in Phase 5 as a
--      per-source recall breakdown rather than hiding it in the average.
