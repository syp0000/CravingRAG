-- ============================================================
-- 16_demand_supply_mart.sql — ANALYTICS.DEMAND_SUPPLY_GAPS
-- ============================================================
-- The product decision in one table:
--   "Which craving combinations have high search demand but insufficient menu
--    supply, and what should we add next?"
--
--   demand_share      = an intent's share of searches within its scenario
--                       (SYNTHETIC — data/demand_scenarios.yml, labeled per row)
--   supply_share      = dishes matching the intent / searchable catalog
--                       (REAL — Cortex-extracted axes over 19,260 dishes)
--   opportunity_index = demand_share / supply_share
--                       > 1: people ask for it more than the menu offers it.
--   low_coverage_rate = share of searches that returned fewer than 5 candidates
--                       after the parser's own axes + exclusions (the top-5 product
--                       could not fill its slots).
--
-- Grain: (scenario_id, intent_key), authored intent. Parsed intent is deliberately
-- NOT used for demand here; that comparison is parser-quality work, not menu work.
-- Only synthetic_demo rows enter this mart until live_demo has a scenario story.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

CREATE OR REPLACE VIEW ANALYTICS.DEMAND_SUPPLY_GAPS AS
WITH supply AS (           -- measured by the generator via ANALYTICS.CANDIDATE_COUNT
    SELECT intent_key, matching_dishes, catalog_size AS n FROM ANALYTICS.INTENT_DEFS
),
demand AS (
    SELECT scenario_id,
           authored_intent:intent_key::string             AS intent_key,
           COUNT(*)                                       AS search_count,
           AVG(candidate_count)                           AS avg_candidate_count,
           AVG(IFF(candidate_count < 5, 1, 0))            AS low_coverage_rate,
           MAX(generator_version)                         AS generator_version,
           MAX(seed)                                      AS seed
    FROM ANALYTICS.SEARCH_EVENTS
    WHERE source = 'synthetic_demo'
    GROUP BY 1, 2
)
SELECT d.scenario_id,
       d.intent_key,
       d.search_count,
       ROUND(d.search_count / SUM(d.search_count) OVER (PARTITION BY d.scenario_id), 4) AS demand_share,
       s.matching_dishes,
       ROUND(s.matching_dishes / s.n, 4)                                                 AS supply_share,
       ROUND(d.search_count / SUM(d.search_count) OVER (PARTITION BY d.scenario_id)
             / NULLIF(s.matching_dishes / s.n, 0), 2)                                    AS opportunity_index,
       ROUND(d.avg_candidate_count, 1)                                                   AS avg_candidate_count,
       ROUND(d.low_coverage_rate, 3)                                                     AS low_coverage_rate,
       'synthetic_demo'                                                                  AS demand_source,
       d.generator_version,
       d.seed
FROM demand d
JOIN supply s USING (intent_key);

-- ------------------------------------------------------------
-- The first completion criterion. Not a dashboard: this query.
-- ------------------------------------------------------------
SELECT *
FROM ANALYTICS.DEMAND_SUPPLY_GAPS
ORDER BY opportunity_index DESC;
-- Expect fresh_spicy at the top under phoenix_summer: 40% of demand against
-- ~1.2% of the catalog (240 / 19,260; sql/14's 230 is the uncurated-cuisine bucket alone). Reproducible: same yml version + seed →
-- identical rows.

-- Parser-quality side note (authored vs parsed), available because the two are
-- stored separately. Not part of the mart.
SELECT authored_intent:intent_key::string AS authored,
       parsed_axes,
       COUNT(*) AS searches
FROM ANALYTICS.SEARCH_EVENTS
WHERE source = 'synthetic_demo'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
