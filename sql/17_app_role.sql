-- ============================================================
-- 17_app_role.sql — least-privilege role for the deployed demo server
-- ============================================================
-- ui/server.py defaults to this role (SNOWFLAKE_ROLE overrides). The server
-- only ever: SELECTs the catalog/signal/analytics tables and views, calls
-- V2.PARSE_CRAVING + AI_EMBED, and INSERTs one row per search into
-- ANALYTICS.SEARCH_EVENTS. Nothing here can create, drop, or administer.
-- How to run: paste into a Snowsight worksheet as ACCOUNTADMIN and execute.
-- ============================================================

CREATE ROLE IF NOT EXISTS CRAVING_APP;

GRANT USAGE ON WAREHOUSE CRAVING_WH TO ROLE CRAVING_APP;
GRANT USAGE ON DATABASE CRAVING_RAG TO ROLE CRAVING_APP;
GRANT USAGE ON ALL SCHEMAS IN DATABASE CRAVING_RAG TO ROLE CRAVING_APP;

-- read everything, write exactly one table
GRANT SELECT ON ALL TABLES IN DATABASE CRAVING_RAG TO ROLE CRAVING_APP;
GRANT SELECT ON ALL VIEWS   IN DATABASE CRAVING_RAG TO ROLE CRAVING_APP;
GRANT USAGE  ON ALL FUNCTIONS IN DATABASE CRAVING_RAG TO ROLE CRAVING_APP;  -- V2.PARSE_CRAVING
GRANT INSERT ON TABLE CRAVING_RAG.ANALYTICS.SEARCH_EVENTS TO ROLE CRAVING_APP;

-- AI_EMBED / AI_COMPLETE at query time
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE CRAVING_APP;

-- Finally, let the service user assume it (replace with the user from your
-- SNOWFLAKE_USER env var / .dlt/secrets.toml):
-- GRANT ROLE CRAVING_APP TO USER <service_user>;

-- ------------------------------------------------------------
-- Verify (as the service user, USE ROLE CRAVING_APP):
-- ------------------------------------------------------------
-- SELECT COUNT(*) FROM CRAVING_RAG.RAW.CURATED_RECIPES;
-- SELECT CRAVING_RAG.V2.PARSE_CRAVING('warm spicy soup');
-- SELECT AI_EMBED('snowflake-arctic-embed-l-v2.0', 'ok');
