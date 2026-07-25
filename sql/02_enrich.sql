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
        -- Instructions are cut harder than ingredients: flavor comes mostly from what
        -- is in the dish, while the method matters only for texture, which the first
        -- couple of steps already reveal. Epicurious detail averages ~1,015 characters
        -- and dominates the token bill, so this trims roughly a third off the cost and
        -- buys a proportionally larger sample.
        'Ingredients: ' || LEFT(ingredients, 600)
            || '\nMethod: ' || LEFT(instructions, 300)  AS detail
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
            -- ⚠️ WRITE FOR AN EMBEDDING, NOT FOR A READER.
            --
            -- The prose version of this prompt produced beautiful, useless text. Every
            -- profile came out as "This dish is a harmonious blend of X and Y, with a
            -- subtle hint of Z" — the same skeleton with different adjectives slotted in.
            -- Embedded, those documents look nearly identical: the top 10 results for a
            -- query spanned only 0.516 to 0.416, so a fried pastry scored about as well
            -- as a fruit slush for "refreshing and bursting with juice".
            --
            -- The shared scaffolding ("this dish is", "a blend of", "a subtle hint of")
            -- is most of the token count and carries no information, so it dominates the
            -- vector while the part that actually distinguishes dishes gets diluted.
            --
            -- Terse, noun-dense text embeds far better. Fluency is worth nothing here;
            -- nobody reads these.
            'Write a compact search description for this dish. ',
            'Format exactly, four short parts separated by periods:\n',
            '<what kind of dish it is>. <taste words>. <texture words>. ',
            '<the few ingredients that define its flavor>.\n\n',
            'Example: "Chilled citrus fruit salad. Bright, tart, sweet. Juicy, crisp, ',
            'watery. Orange, grapefruit, mint."\n',
            'Example: "Hot spicy noodle soup. Savory, fiery, deep. Chewy noodles, ',
            'soft vegetables, brothy. Gochugaru, seafood, wheat noodles."\n\n',
            'Rules:\n',
            '- NEVER write "this dish", "harmonious", "delightful", "subtle", ',
            '"offers", "boasts", or any full sentence.\n',
            '- Use concrete, specific words a person would actually search for.\n',
            -- Texture must follow the COOKING METHOD, not the raw ingredient. Without
            -- this the model reads "vegetables" and writes "crunchy" even for a
            -- simmered stew, and "rice powder" as "crumbly" for songpyeon, which is chewy.
            '- Texture must match how it is COOKED, not the raw ingredients. Vegetables ',
            'simmered in a stew are soft, not crunchy; steamed dough is chewy, not crumbly.\n',
            '- Base every flavor word on the text below. If the text does not support ',
            'a flavor, leave it out rather than inventing one.\n',
            '- Do NOT mention serving temperature or occasion.\n\n',
            'Dish: ', title, '\n',
            detail
        )
    ) AS sensory_profile,

    -- Explicitly model knowledge, not source-derived. Kept separate so it can never be
    -- mistaken for something the source said.
    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            -- Terse here too, for the same reason: "Someone would eat this when they
            -- want a warm, comforting meal" is 12 words of scaffolding around 2 words
            -- of signal.
            'List when this dish is eaten, as short phrases separated by commas. ',
            'Cover: serving temperature, season, meal, occasion. No sentences.\n',
            'Example: "Served hot. Winter. Lunch or dinner. Comfort food, hangover cure."\n',
            'Example: "Served cold. Summer. Dessert or snack. Refreshing, casual."\n',
            'If you are not confident about an item, leave it out.\n\n',
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
-- ⭐ ASYMMETRIC SAMPLING — enrich all of the cheap source, sample the expensive one.
--
-- These two sources cost wildly different amounts per row, because Epicurious carries
-- ~1,015 characters of detail against worldcuisines' ~198:
--     Epicurious    13,495 rows  →  13.1M tokens
--     worldcuisines  2,075 rows  →   1.2M tokens   (1/11th the cost)
--
-- And all the corpus diversity lives in the cheap one. Sampling both evenly was what
-- made the Korean query fail: at ~14% coverage only ~9 of 63 Korean dishes and ~2 of
-- 15 Korean soups were ever enriched, so "warm broth for a hangover" had essentially
-- nothing to retrieve. The retriever was fine; the corpus had no answer in it.
--
-- So: take worldcuisines whole, sample Epicurious. Full international coverage for
-- about 15% of what a full run on everything would cost.
QUALIFY ROW_NUMBER() OVER (PARTITION BY source ORDER BY RANDOM())
        <= CASE source
               WHEN 'worldcuisines' THEN 999999   -- all of it
               ELSE 4000                          -- sample; cheaper per row now that detail is trimmed
           END;


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

-- ------------------------------------------------------------
-- 💰 WHAT DID THAT ACTUALLY COST?
-- ------------------------------------------------------------
-- Run this after every enrichment. Two reasons:
--   1. It tells you what a full-corpus run would cost before you commit to one —
--      multiply by (15,570 / rows_you_just_did).
--   2. Cost per row is a Phase 5 metric. Almost no portfolio project reports what its
--      LLM pipeline cost to run, and it is the first thing a data team asks.
SELECT
    model_name,
    function_name,
    SUM(tokens)         AS tokens,
    SUM(token_credits)  AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY
WHERE start_time >= DATEADD('hour', -2, CURRENT_TIMESTAMP())
GROUP BY model_name, function_name
ORDER BY credits DESC;

-- Note: ACCOUNT_USAGE views lag by up to ~2 hours, so this may be empty right after a
-- run. CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY gives per-query detail if you need it sooner.
--
-- TODO (Phase 5 experiment): mistral-large2 is one of the pricier models. Re-run the
-- enrichment with a cheaper one (llama3.1-8b, mistral-7b) on the same 200 dishes and
-- compare both the profile quality AND the credits. "Model X cost 6x less and scored
-- within 3% on Recall@5" is a genuinely strong result — that is the tradeoff real teams
-- argue about.


-- ------------------------------------------------------------
-- 🤖 BOILERPLATE DETECTOR — the quality check that does NOT need domain knowledge
-- ------------------------------------------------------------
-- Spotting that "earthy" is wrong for jjinppang takes someone who has eaten one, and
-- that does not scale past the cuisines you happen to know. But a stock phrase repeating
-- across unrelated dishes is detectable without knowing anything about food — and it is
-- a reliable smell, because a phrase the model reaches for regardless of the dish is by
-- definition not describing any of them.
--
-- "juicy crunch" turned up in sundubu-jjigae, chow mein and hot-and-sour noodles in a
-- single sample of ten. Two of those are simmered dishes with nothing crunchy in them.
WITH phrases AS (
    SELECT
        dish_id,
        LOWER(TRIM(value::STRING)) AS phrase
    FROM ENRICHED.RECIPE_PROFILES,
         LATERAL FLATTEN(INPUT => SPLIT(
             -- crude trigram-ish split: break the profile on commas and periods
             REGEXP_REPLACE(LOWER(sensory_profile), '[.,;]', '|'), '|'))
    WHERE LENGTH(TRIM(value::STRING)) BETWEEN 8 AND 40
)
SELECT
    phrase,
    COUNT(DISTINCT dish_id) AS dishes_using_it
FROM phrases
GROUP BY phrase
HAVING COUNT(DISTINCT dish_id) > 1
ORDER BY dishes_using_it DESC
LIMIT 20;
-- Anything appearing across many unrelated dishes is a tic. Add it to the "avoid stock
-- phrases" instruction in the prompt above, or make the instruction stronger, and rerun.
-- Run this again after every prompt change — it is cheap and needs no expertise.


-- TODO (learning): if the profiles read flat or generic, edit the prompt above and rerun.
--   A single prompt line can noticeably change retrieval quality — this is exactly why
--   the indexing stage matters so much in RAG.
--
-- Experiments worth running:
--   1. Drop "Be vivid and sensory" — how does the output change?
--   2. Do worldcuisines profiles come out weaker than Epicurious ones? They start from
--      less detail, so they may. If so, that is worth reporting in Phase 5 as a
--      per-source recall breakdown rather than hiding it in the average.
