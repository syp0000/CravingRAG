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

    -- ⭐ TWO SEPARATE FIELDS, deliberately.
    --
    -- The earlier single-prompt version asked for taste, texture, temperature AND
    -- occasion in one shot. But a source line like "a melon stuffed with meat and rice"
    -- supports taste and texture only — it says nothing about serving temperature or
    -- occasion. Demanding all four forced the model to invent the last two, and the
    -- observed errors clustered there exactly as you would predict: stuffed melon came
    -- back as "cool melon flesh" alongside "warm stuffing" (self-contradictory for a
    -- cooked dish), and dovga as "delightfully cool" when it is traditionally served hot.
    --
    -- Dropping occasion entirely is not the answer either — "cozy for a rainy day" is
    -- precisely the query this project exists to serve. So generate both, keep them in
    -- separate columns, and let Phase 5 measure what each contributes.
    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'You are a food writer. In 2 sentences, describe ONLY the taste ',
            '(sweet/sour/spicy/rich) and texture (crispy/juicy/creamy/chewy) of this dish. ',
            'Every claim must be supported by the text below. If the text does not ',
            'indicate a flavor or texture, stay general rather than inventing one. ',
            'Do NOT mention serving temperature or occasion. ',
            'Do NOT list ingredients or steps.\n\n',
            'Dish: ', title, '\n',
            detail
        )
    ) AS sensory_profile,

    -- Explicitly model knowledge, not source-derived. Kept separate so it can never be
    -- mistaken for something the source said.
    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'In ONE sentence, state when someone would eat this dish: serving temperature, ',
            'season, occasion, or mood. If you are not confident, say only what you are ',
            'sure of and keep it general. Do not invent specific cultural claims.\n\n',
            'Dish: ', title, '\n',
            detail
        )
    ) AS context_profile,

    CURRENT_TIMESTAMP() AS enriched_at
    -- 03_embed.sql builds flavor_profile = sensory_profile || ' ' || context_profile
    -- and embeds that. Keeping the parts separate here means Phase 5 can embed
    -- sensory-only as a fourth arm and measure what the inferred context is worth —
    -- retrieval gain on occasion queries, against hallucination risk.

FROM all_dishes
-- Sample both sources rather than taking the first N rows, which would be all
-- Epicurious and would not exercise the cross-lingual queries at all.
QUALIFY ROW_NUMBER() OVER (PARTITION BY source ORDER BY RANDOM()) <= 10;
-- 👆 10 per source = 20 rows. TODO: raise once the output looks good.


-- ------------------------------------------------------------
-- Read the output. This is where you judge prompt quality.
-- ------------------------------------------------------------
SELECT source, cuisine, title, sensory_profile, context_profile
FROM ENRICHED.RECIPE_PROFILES
ORDER BY source
LIMIT 20;

-- Sanity check: both sources present?
SELECT source, COUNT(*) FROM ENRICHED.RECIPE_PROFILES GROUP BY source;


-- ------------------------------------------------------------
-- ⚠️ GROUNDING SPOT CHECK — run this every time you change the prompt
-- ------------------------------------------------------------
-- Read the source text and the generated profile side by side and ask:
-- "is every flavor claim actually supported by the text on the left?"
--
-- Do this for dishes you personally know. A profile can read beautifully and still
-- be wrong — the first version of this prompt called jjinppang "earthy", which no
-- one who has eaten one would say. Domain knowledge is the only detector here, so
-- check the cuisines you know best.
SELECT
    title,
    LEFT(detail, 300)  AS source_text,
    sensory_profile,
    context_profile
FROM ENRICHED.RECIPE_PROFILES
WHERE source = 'worldcuisines'      -- the thin-input source, most at risk
ORDER BY LENGTH(detail) ASC          -- least source detail first = most invention
LIMIT 10;

-- TODO (learning): if the profiles read flat or generic, edit the prompt above and rerun.
--   A single prompt line can noticeably change retrieval quality — this is exactly why
--   the indexing stage matters so much in RAG.
--
-- Experiments worth running:
--   1. Drop "Be vivid and sensory" — how does the output change?
--   2. Do worldcuisines profiles come out weaker than Epicurious ones? They start from
--      less detail, so they may. If so, that is worth reporting in Phase 5 as a
--      per-source recall breakdown rather than hiding it in the average.
