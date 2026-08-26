-- ============================================================
-- 15_demand_events.sql — the demand side: ANALYTICS.SEARCH_EVENTS
-- ============================================================
-- Product decision: "Which craving combinations have high search demand but
-- insufficient menu supply, and what should we add next?"
--
-- Supply already exists (Cortex-extracted axes, sql/08, sql/14). Demand did not:
-- this project has no search traffic. This file creates the ONE event table both
-- synthetic traffic (pipelines/generate_demo_demand.py, from data/demand_scenarios.yml)
-- and later real /search calls write to. `source` keeps them apart; never mix them
-- in a number without saying so.
--
-- authored_intent = what the generator meant.  parsed_* = what V2.PARSE_CRAVING
-- understood. Kept separate on purpose: their disagreement IS the parser-quality
-- measurement.
--
-- Run once, before the generator. Idempotent.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE SCHEMA IF NOT EXISTS ANALYTICS;

CREATE TABLE IF NOT EXISTS ANALYTICS.SEARCH_EVENTS (
    event_id          STRING        NOT NULL,
    occurred_at       TIMESTAMP_NTZ NOT NULL,
    query_text        STRING        NOT NULL,
    scenario_id       STRING,                 -- NULL for live_demo
    authored_intent   VARIANT,                -- {intent_key, exclusion_key}; NULL for live_demo
    parsed_concepts   VARIANT,                -- V2.PARSE_CRAVING(query_text):concepts
    parsed_axes       VARIANT,                -- concepts -> wiki targets, MAX per axis
    exclusions        ARRAY,                  -- V2.PARSE_CRAVING(query_text):exclude
    candidate_count   NUMBER,                 -- ANALYTICS.CANDIDATE_COUNT(parsed_axes, exclusions)
    source            STRING        NOT NULL, -- synthetic_demo | live_demo
    generator_version NUMBER,                 -- demand_scenarios.yml `version`; NULL for live_demo
    seed              NUMBER
);

-- One parse per unique phrasing. The generator reads this before calling Cortex, so
-- 3,000 events cost ~50 LLM calls, and a rerun costs zero (same rule as EVAL2.V2_PARSED).
CREATE TABLE IF NOT EXISTS ANALYTICS.QUERY_PARSES (
    query_text      STRING PRIMARY KEY,
    parsed          VARIANT,
    parsed_axes     VARIANT,
    exclusions      ARRAY,
    candidate_count NUMBER,
    parsed_at       TIMESTAMP_NTZ
);

-- Intent definitions, loaded from demand_scenarios.yml `intents` by the generator,
-- which also fills matching_dishes = CANDIDATE_COUNT(target_axes, []) per row. Supply
-- is materialized here rather than in the mart view because Snowflake will not
-- inline a table-scanning SQL UDF called with a column argument inside a VIEW.
CREATE TABLE IF NOT EXISTS ANALYTICS.INTENT_DEFS (
    intent_key      STRING PRIMARY KEY,
    target_axes     VARIANT,                  -- {"fresh":1.0,"spicy":1.0} / {"savory":1.0,"rich":0.0}
    matching_dishes NUMBER,                   -- real supply, measured at generation time
    catalog_size    NUMBER,                   -- COUNT(*) FROM V2.RECIPE_AXES at that time
    measured_at     TIMESTAMP_NTZ
);

-- ------------------------------------------------------------
-- The one supply rule. Used for BOTH per-query candidate_count (parsed axes +
-- exclusions) and per-intent matching_dishes (authored axes, no exclusions).
--   target >= 0.6 → dish must score >= 0.6 on that axis (sql/13 "offers")
--   target <= 0.2 → dish must score <= 0.35 or be unmeasured (UI "light" dial)
--   otherwise      → no constraint (a 0.5 side-implication does not filter)
-- Exclusions: substring over title+ingredients+NER, term + V2.EXCLUSION_ALIASES,
-- same rule as retrieval (sql/10, ui/server.py).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION ANALYTICS.CANDIDATE_COUNT(axes VARIANT, exclusions ARRAY)
RETURNS NUMBER
AS
$$
    WITH needles AS (
        SELECT e.value::string AS needle FROM TABLE(FLATTEN(input => exclusions)) e
        UNION ALL
        SELECT al.alias FROM TABLE(FLATTEN(input => exclusions)) e
        JOIN V2.EXCLUSION_ALIASES al ON al.canonical_term = e.value::string
    ),
    fit AS (
        SELECT a.recipe_id
        FROM V2.RECIPE_AXES a
        WHERE (axes:spicy      IS NULL OR (axes:spicy::float      >= 0.6 AND a.spicy      >= 0.6) OR (axes:spicy::float      <= 0.2 AND COALESCE(a.spicy, 0)      <= 0.35) OR axes:spicy::float      BETWEEN 0.21 AND 0.59)
          AND (axes:warm       IS NULL OR (axes:warm::float       >= 0.6 AND a.warm       >= 0.6) OR (axes:warm::float       <= 0.2 AND COALESCE(a.warm, 0)       <= 0.35) OR axes:warm::float       BETWEEN 0.21 AND 0.59)
          AND (axes:brothy     IS NULL OR (axes:brothy::float     >= 0.6 AND a.brothy     >= 0.6) OR (axes:brothy::float     <= 0.2 AND COALESCE(a.brothy, 0)     <= 0.35) OR axes:brothy::float     BETWEEN 0.21 AND 0.59)
          AND (axes:savory     IS NULL OR (axes:savory::float     >= 0.6 AND a.savory     >= 0.6) OR (axes:savory::float     <= 0.2 AND COALESCE(a.savory, 0)     <= 0.35) OR axes:savory::float     BETWEEN 0.21 AND 0.59)
          AND (axes:rich       IS NULL OR (axes:rich::float       >= 0.6 AND a.rich       >= 0.6) OR (axes:rich::float       <= 0.2 AND COALESCE(a.rich, 0)       <= 0.35) OR axes:rich::float       BETWEEN 0.21 AND 0.59)
          AND (axes:fresh      IS NULL OR (axes:fresh::float      >= 0.6 AND a.fresh      >= 0.6) OR (axes:fresh::float      <= 0.2 AND COALESCE(a.fresh, 0)      <= 0.35) OR axes:fresh::float      BETWEEN 0.21 AND 0.59)
          AND (axes:sweet      IS NULL OR (axes:sweet::float      >= 0.6 AND a.sweet      >= 0.6) OR (axes:sweet::float      <= 0.2 AND COALESCE(a.sweet, 0)      <= 0.35) OR axes:sweet::float      BETWEEN 0.21 AND 0.59)
          AND (axes:comforting IS NULL OR (axes:comforting::float >= 0.6 AND a.comforting >= 0.6) OR (axes:comforting::float <= 0.2 AND COALESCE(a.comforting, 0) <= 0.35) OR axes:comforting::float BETWEEN 0.21 AND 0.59)
    )
    -- no correlated subquery: SQL UDFs cannot inline one when called from inside a CTE
    SELECT COUNT(*)
    FROM (
        SELECT f.recipe_id
        FROM fit f
        JOIN (SELECT recipe_id,
                     LOWER(COALESCE(title,'')||' '||COALESCE(ingredients,'')||' '||COALESCE(ner,'')) AS hay
              FROM raw.curated_recipes) h USING (recipe_id)
        LEFT JOIN needles n ON h.hay LIKE '%' || n.needle || '%'
        GROUP BY f.recipe_id
        HAVING COUNT(n.needle) = 0
    )
$$;

-- ------------------------------------------------------------
-- Done-when checks
-- ------------------------------------------------------------
-- The real measurement the demo is built on. sql/14 quoted 230: that is the
-- 'uncurated' cuisine bucket; the whole searchable catalog is 240 (same view):
SELECT ANALYTICS.CANDIDATE_COUNT(PARSE_JSON('{"fresh":1.0,"spicy":1.0}'), ARRAY_CONSTRUCT()) AS fresh_spicy_supply;
-- expect 240 (2026-08-26), identical to SEMANTIC_VIEW(V2.SENSORY_CATALOG) fresh_and_spicy

-- Exclusion bites: the same intent, minus shellfish (shrimp/prawn/crab... via aliases)
SELECT ANALYTICS.CANDIDATE_COUNT(PARSE_JSON('{"fresh":1.0,"spicy":1.0}'), ARRAY_CONSTRUCT('shellfish')) AS fresh_spicy_no_shellfish;
-- expect < 240 (196 on 2026-08-26)

-- Empty until the generator runs:
SELECT source, COUNT(*) FROM ANALYTICS.SEARCH_EVENTS GROUP BY source;
