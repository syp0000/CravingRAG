-- ============================================================
-- 01_setup.sql — one-time account setup
-- ============================================================
-- How to run: paste into a Snowsight worksheet and execute.
-- ============================================================

-- XSMALL is plenty. Short AUTO_SUSPEND is the single biggest trial-credit saver.
CREATE WAREHOUSE IF NOT EXISTS CRAVING_WH
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND   = 60      -- suspend after 60s idle
  AUTO_RESUME    = TRUE
  INITIALLY_SUSPENDED = TRUE;

CREATE DATABASE IF NOT EXISTS CRAVING_RAG;

USE DATABASE CRAVING_RAG;

-- Three schemas = three pipeline stages (same idea as bronze/silver/gold).
CREATE SCHEMA IF NOT EXISTS RAW;        -- what dlt loads, untouched
CREATE SCHEMA IF NOT EXISTS ENRICHED;   -- LLM-generated flavor profiles
CREATE SCHEMA IF NOT EXISTS SEARCH;     -- embedding vectors

-- ------------------------------------------------------------
-- Verify
-- ------------------------------------------------------------
SHOW SCHEMAS IN DATABASE CRAVING_RAG;

-- Confirm Cortex is available in this region BEFORE building anything on it.
SELECT AI_EMBED('snowflake-arctic-embed-l-v2.0', 'hello world') AS test_vector;
SELECT SNOWFLAKE.CORTEX.COMPLETE('mistral-large2', 'Say OK') AS test_llm;

-- TODO: If either statement errors, it is most likely a region issue.
--       Check the Cortex availability table in the Snowflake docs. If your region
--       is unsupported, recreate the trial account in a supported one (e.g. AWS us-west-2).
