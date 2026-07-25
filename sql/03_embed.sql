-- ============================================================
-- 03_embed.sql — turn flavor profiles into vectors
-- ============================================================
-- An embedding converts text into an array of numbers (a vector).
-- Texts with similar meaning land near each other in that vector space.
--
-- Model choice matters here:
--   Recipes are English; queries may be English or Korean → use a MULTILINGUAL model.
--   snowflake-arctic-embed-l-v2.0  (1024 dims, multilingual) ✅
--   snowflake-arctic-embed-m-v1.5  (768 dims, English-only)  ❌ breaks Korean queries
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE OR REPLACE TABLE SEARCH.RECIPE_VECTORS AS
SELECT
    uid,
    name,
    ingredients,
    flavor_profile,

    -- 👇 the embedding step: text → VECTOR(FLOAT, 1024)
    AI_EMBED('snowflake-arctic-embed-l-v2.0', flavor_profile) AS profile_vec

FROM ENRICHED.RECIPE_PROFILES
WHERE flavor_profile IS NOT NULL;


-- ------------------------------------------------------------
-- Look at an actual vector once, to build intuition
-- ------------------------------------------------------------
SELECT name, profile_vec
FROM SEARCH.RECIPE_VECTORS
LIMIT 1;
-- → [0.021, -0.043, 0.11, ...] — 1024 numbers.
--   Unreadable to a human, but the *direction* of those numbers encodes meaning.


-- ------------------------------------------------------------
-- TODO (learning): run this. It is the fastest way to understand embeddings.
-- Compare similarity across three different phrasings.
-- ------------------------------------------------------------
SELECT
    VECTOR_COSINE_SIMILARITY(
        AI_EMBED('snowflake-arctic-embed-l-v2.0', 'refreshing and bursting with juice'),
        AI_EMBED('snowflake-arctic-embed-l-v2.0', 'bright citrus, crisp and juicy')
    ) AS same_meaning_english,      -- should be HIGH

    VECTOR_COSINE_SIMILARITY(
        AI_EMBED('snowflake-arctic-embed-l-v2.0', '상큼하고 과즙이 터지는'),
        AI_EMBED('snowflake-arctic-embed-l-v2.0', 'refreshing and bursting with juice')
    ) AS cross_lingual_same_meaning, -- should ALSO be high — this is the multilingual model working

    VECTOR_COSINE_SIMILARITY(
        AI_EMBED('snowflake-arctic-embed-l-v2.0', 'refreshing and bursting with juice'),
        AI_EMBED('snowflake-arctic-embed-l-v2.0', 'heavy greasy deep fried pork')
    ) AS opposite_meaning;           -- should be LOW

-- Seeing these three numbers side by side teaches "what an embedding is" faster than
-- any explanation. The cross-lingual column is the one worth showing off.
