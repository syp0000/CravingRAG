-- ============================================================
-- 14_semantic_view.sql — E: the sensory axes as a business-facing semantic layer
-- ============================================================
-- The point of the whole business side in one file: Cortex extracted craving-language
-- attributes from unstructured recipe text (sql/08); this view exposes them as named
-- dimensions/metrics with synonyms, so Cortex Analyst can turn a product manager's
-- question — "how many dishes satisfy fresh + spicy?" — into SQL nobody has to write.
--
-- To demo: Snowsight → AI & ML → Cortex Analyst → select V2.SENSORY_CATALOG, then ask:
--   "How many dishes are both fresh and spicy?"
--   "Which cuisine has the highest average spicy score?"
--   "How many spicy dishes do we have per cuisine?"
-- Measured 2026-08-22 (19,260-dish searchable catalog): 1,076 spicy dishes, but only
-- 230 fresh+spicy — the underserved-combination finding, now one Analyst question away.
--
-- No behavioral data is declared here: every fact is extracted from the catalog itself.
-- If user events existed, they would join on recipe_id and add save_rate/CTR metrics —
-- the schema is ready for that table; the data is not invented.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ① Wide analytics view: Analyst reasons over plain columns, not VARIANT paths.
--    Component titles (sauces, pastes) are excluded — dishes only, same rule as retrieval.
CREATE OR REPLACE VIEW V2.RECIPE_AXES AS
SELECT r.recipe_id, r.title, r.cuisine,
       s.signals:spicy::float      AS spicy,
       s.signals:warm::float       AS warm,
       s.signals:brothy::float     AS brothy,
       s.signals:savory::float     AS savory,
       s.signals:rich::float       AS rich,
       s.signals:fresh::float      AS fresh,
       s.signals:sweet::float      AS sweet,
       s.signals:comforting::float AS comforting
FROM raw.curated_recipes r
JOIN V2.RECIPE_SIGNALS s USING (recipe_id)
JOIN V2.SEARCHABLE_RECIPES USING (recipe_id);

-- ② The semantic layer Cortex Analyst reads.
CREATE OR REPLACE SEMANTIC VIEW V2.SENSORY_CATALOG
  TABLES (
    recipes AS V2.RECIPE_AXES PRIMARY KEY (recipe_id)
      WITH SYNONYMS ('dishes','catalog','menu')
      COMMENT = 'One row per recipe; sensory axis values 0-1 extracted from recipe text by Cortex, NULL when no evidence'
  )
  FACTS (
    recipes.spicy AS spicy, recipes.warm AS warm, recipes.brothy AS brothy,
    recipes.savory AS savory, recipes.rich AS rich, recipes.fresh AS fresh,
    recipes.sweet AS sweet, recipes.comforting AS comforting
  )
  DIMENSIONS (
    recipes.title AS title WITH SYNONYMS ('dish name','recipe name'),
    recipes.cuisine AS cuisine WITH SYNONYMS ('food culture')
  )
  METRICS (
    recipes.dish_count AS COUNT(recipe_id) WITH SYNONYMS ('number of dishes'),
    recipes.avg_spicy AS AVG(spicy), recipes.avg_rich AS AVG(rich),
    recipes.avg_fresh AS AVG(fresh), recipes.avg_sweet AS AVG(sweet),
    recipes.spicy_dishes AS COUNT_IF(spicy >= 0.6) WITH SYNONYMS ('spicy dish count'),
    recipes.fresh_and_spicy AS COUNT_IF(spicy >= 0.6 AND fresh >= 0.6)
      WITH SYNONYMS ('fresh spicy supply')
      COMMENT = 'dishes satisfying both fresh and spicy cravings'
  )
  COMMENT = 'Sensory catalog: craving-language attributes extracted from unstructured recipes, queryable as business dimensions';

-- ③ Sanity: the same question, asked directly against the semantic layer.
SELECT * FROM SEMANTIC_VIEW(V2.SENSORY_CATALOG
    METRICS recipes.dish_count, recipes.spicy_dishes, recipes.fresh_and_spicy
    DIMENSIONS recipes.cuisine)
ORDER BY 2 DESC;
-- 2026-08-22: uncurated 18,930 dishes / 1,076 spicy / 230 fresh+spicy — the
-- underrepresented-combination story, measured.

-- ------------------------------------------------------------
-- ④ Demand → Supply → Decision (added 2026-08-26, after sql/15 + sql/16)
--    The catalog view above answers "what do we offer?". This one answers the
--    product question: "what do people ask for that we do not offer enough of?"
--    Demand rows are SYNTHETIC (data/demand_scenarios.yml, labeled per row);
--    supply rows are the real Cortex-extracted catalog. Analyst questions:
--      "Which intent has the highest opportunity index in phoenix_summer?"
--      "How many searches for fresh spicy food were there per scenario?"
--      "What is the supply share of fresh_spicy?"
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.DEMAND_SUPPLY_GAPS_ROWS AS
SELECT scenario_id || '/' || intent_key AS gap_id, * FROM ANALYTICS.DEMAND_SUPPLY_GAPS;

CREATE OR REPLACE SEMANTIC VIEW ANALYTICS.DEMAND_SUPPLY
  TABLES (
    gaps AS ANALYTICS.DEMAND_SUPPLY_GAPS_ROWS PRIMARY KEY (gap_id)
      WITH SYNONYMS ('demand supply gaps','opportunities','menu gaps')
      COMMENT = 'One row per (scenario, craving intent). search_count/demand_share are SYNTHETIC demo traffic from data/demand_scenarios.yml; matching_dishes/supply_share are real catalog measurements'
  )
  FACTS (
    gaps.search_count AS search_count, gaps.demand_share AS demand_share,
    gaps.matching_dishes AS matching_dishes, gaps.supply_share AS supply_share,
    gaps.opportunity_index AS opportunity_index,
    gaps.avg_candidate_count AS avg_candidate_count, gaps.low_coverage_rate AS low_coverage_rate
  )
  DIMENSIONS (
    gaps.scenario_id AS scenario_id WITH SYNONYMS ('scenario','traffic scenario','season'),
    gaps.intent_key AS intent_key WITH SYNONYMS ('intent','craving combination','craving'),
    gaps.demand_source AS demand_source WITH SYNONYMS ('data source')
  )
  METRICS (
    gaps.total_searches AS SUM(search_count) WITH SYNONYMS ('searches','search volume'),
    gaps.max_opportunity AS MAX(opportunity_index) WITH SYNONYMS ('biggest gap','highest opportunity'),
    gaps.dishes AS MAX(matching_dishes) WITH SYNONYMS ('supply','menu supply')
  )
  COMMENT = 'Demand vs supply per craving intent. opportunity_index = demand_share / supply_share, above 1 means searched for more than the menu offers. Demand is synthetic demo data, supply is real.';

-- 2026-08-26: phoenix_summer / fresh_spicy on top at 34.2 (42.7% of demand vs 1.25% of catalog).
SELECT * FROM SEMANTIC_VIEW(ANALYTICS.DEMAND_SUPPLY
    METRICS gaps.total_searches, gaps.max_opportunity
    DIMENSIONS gaps.scenario_id, gaps.intent_key)
ORDER BY 2 DESC LIMIT 5;
