-- ============================================================
-- 06_v1_baseline.sql — W1.4: V1 profiles + embeddings over the curated corpus
-- ============================================================
-- ⚠️ CONTROL ARM. The prompts below are copied VERBATIM from sql/02_enrich.sql and the
-- embedding recipe from sql/03_embed.sql. Do not improve anything here — a better prompt
-- in the control arm destroys the V1-vs-V2 comparison. Improvement ideas go to W2.
--
-- Changes from v1 are source-shaped only:
--   raw.curated_recipes instead of the two-source union · `directions` instead of
--   `instructions` · no sampling (all 342 rows) · legacy CORTEX.COMPLETE + mistral-large2
--   kept on purpose (that is what v1 used; V2 will use AI_COMPLETE).
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE SCHEMA IF NOT EXISTS V1;

-- ------------------------------------------------------------
-- ① Profiles: two frozen prompts (sensory + context), one row per curated recipe
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE V1.RECIPE_PROFILES AS
SELECT
    recipe_id,
    title,
    cuisine,
    pattern,

    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
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
            '- Texture must match how it is COOKED, not the raw ingredients. Vegetables ',
            'simmered in a stew are soft, not crunchy; steamed dough is chewy, not crumbly.\n',
            '- Base every flavor word on the text below. If the text does not support ',
            'a flavor, leave it out rather than inventing one.\n',
            '- Do NOT mention serving temperature or occasion.\n\n',
            'Dish: ', title, '\n',
            'Ingredients: ', LEFT(ingredients, 600),
            '\nMethod: ', LEFT(directions, 300)
        )
    ) AS sensory_profile,

    SNOWFLAKE.CORTEX.COMPLETE(
        'mistral-large2',
        CONCAT(
            'List when this dish is eaten, as short phrases separated by commas. ',
            'Cover: serving temperature, season, meal, occasion. No sentences.\n',
            'Example: "Served hot. Winter. Lunch or dinner. Comfort food, hangover cure."\n',
            'Example: "Served cold. Summer. Dessert or snack. Refreshing, casual."\n',
            'If you are not confident about an item, leave it out.\n\n',
            'Dish: ', title, '\n',
            'Ingredients: ', LEFT(ingredients, 600),
            '\nMethod: ', LEFT(directions, 300)
        )
    ) AS context_profile,

    CURRENT_TIMESTAMP() AS enriched_at
FROM raw.curated_recipes;


-- ------------------------------------------------------------
-- ② Embeddings: same composition and model as v1's 03_embed.sql
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE V1.RECIPE_PROFILES AS
SELECT
    *,
    title || '. ' || sensory_profile || ' ' || context_profile AS flavor_profile,
    AI_EMBED('snowflake-arctic-embed-l-v2.0',
             title || '. ' || sensory_profile || ' ' || context_profile) AS profile_vec
FROM V1.RECIPE_PROFILES;


-- ------------------------------------------------------------
-- ③ Done-when checks
-- ------------------------------------------------------------
SELECT COUNT(*) AS rows_expected_342 FROM V1.RECIPE_PROFILES;

-- Spot-check 5: terse, noun-dense, no "this dish"/"harmonious"
SELECT title, sensory_profile, context_profile
FROM V1.RECIPE_PROFILES
ORDER BY RANDOM()
LIMIT 5;

-- Boilerplate alarm (v1's detector, kept because it caught the real problem last time):
-- anything here means the frozen prompt regressed — investigate before proceeding
SELECT COUNT(*) AS old_style_rows
FROM V1.RECIPE_PROFILES
WHERE sensory_profile ILIKE '%this dish%' OR sensory_profile ILIKE '%harmonious%';
