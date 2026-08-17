-- ============================================================
-- 10_v2_exclusion.sql — W3.1: hard ingredient exclusion, fail closed
-- ============================================================
-- Runs BEFORE scoring, never inside it. Exclusion axes are not preferences to rank —
-- a dish that violates one is out regardless of how well everything else matches
-- (DECISIONS §6).
--
-- Why an alias table is not optional, measured against the corpus:
--   peanut     5 spellings, all containing "peanut"        → substring alone works
--   almond    12 spellings, but `frangipane` contains none  → aliases needed
--   shellfish 15 spellings, NOT ONE containing "shellfish"  → aliases essential
--                (shrimp, clams, lobster, prawns, crab, scallops, oyster sauce)
-- q14 "warm soup with no shellfish" would filter nothing at all without this table.
--
-- Unregistered terms still work: the lookup unions the term itself, so "cilantro"
-- matches by substring without an entry. Aliases raise recall; they are not a
-- precondition (the parser's open-vocabulary decision depends on this).
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① Alias table — category terms and non-obvious derivatives only
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE V2.EXCLUSION_ALIASES (canonical_term STRING, alias STRING);

INSERT INTO V2.EXCLUSION_ALIASES VALUES
    -- almond: everything else in the corpus contains "almond" already
    ('almond','marzipan'), ('almond','frangipane'), ('almond','amaretto'),
    -- peanut: substring covers the corpus; groundnut kept for robustness
    ('peanut','groundnut'),
    -- shellfish: a category with zero literal occurrences — every row here is load-bearing
    ('shellfish','shrimp'),  ('shellfish','prawn'),    ('shellfish','crab'),
    ('shellfish','lobster'), ('shellfish','clam'),     ('shellfish','mussel'),
    ('shellfish','oyster'),  ('shellfish','scallop'),  ('shellfish','crawfish'),
    ('shellfish','crayfish'),('shellfish','squid'),    ('shellfish','octopus');

-- ------------------------------------------------------------
-- ② The filter: ONE view, used by the scorer AND by the checks below
-- ------------------------------------------------------------
-- History (2026-08-17): this used to be a UDF V2.IS_EXCLUDED(ner, terms). Two problems,
-- both surfaced by an outside review:
--   · the scorer could not call it — Snowflake rejects a subquery-bearing SQL UDF when
--     its ARRAY argument comes from a column ("Unsupported subquery type"); it only ran
--     with literal ARRAY_CONSTRUCT(...) — i.e. in tests, never in production
--   · so the scorer re-implemented the logic inline, and drifted (it searched
--     title+ingredients+NER after Finding 1 in sql/11; the UDF still searched NER only).
--     The tests were testing a function the ranking never used.
-- The fix is a view over the frozen parses: the ranking anti-joins it, the checks read it.
-- One definition, one haystack, one fail-closed rule.
--
-- FAIL CLOSED, twice over:
--   · empty NER → excluded when the query has any exclusion (cannot confirm absence)
--   · a matched term or alias anywhere in title + ingredients + NER → excluded
CREATE OR REPLACE VIEW V2.EXCLUDED_PAIRS AS
WITH terms AS (
    SELECT p.query_id, LOWER(t.value::string) AS term
    FROM EVAL2.V2_PARSED p, LATERAL FLATTEN(input => p.parsed:exclude) t
),
needles AS (                              -- the term itself + registered aliases
    SELECT query_id, term AS needle FROM terms
    UNION ALL
    SELECT t.query_id, a.alias
    FROM terms t JOIN V2.EXCLUSION_ALIASES a ON a.canonical_term = t.term
),
hay AS (                                  -- Finding 1 (sql/11): NER is lossy, search wider
    SELECT recipe_id, ner,
           LOWER(COALESCE(title,'') || ' ' || COALESCE(ingredients,'') || ' ' || COALESCE(ner,'')) AS haystack
    FROM raw.curated_recipes
)
SELECT DISTINCT n.query_id, h.recipe_id
FROM needles n CROSS JOIN hay h
WHERE h.ner IS NULL OR LENGTH(TRIM(h.ner)) = 0
   OR h.haystack LIKE '%' || n.needle || '%';

DROP FUNCTION IF EXISTS V2.IS_EXCLUDED(STRING, ARRAY);   -- the old, untestable form

-- ------------------------------------------------------------
-- ③ Done-when checks — these read the SAME view the ranking uses
-- ------------------------------------------------------------
-- q13: no recipe mentioning almonds (or an alias) survives
SELECT COUNT(*) AS almond_survivors
FROM raw.curated_recipes r
WHERE (LOWER(r.ingredients) LIKE '%almond%' OR LOWER(r.title) LIKE '%almond%'
       OR LOWER(r.ner) LIKE '%marzipan%' OR LOWER(r.ner) LIKE '%frangipane%' OR LOWER(r.ner) LIKE '%amaretto%')
  AND r.recipe_id NOT IN (SELECT recipe_id FROM V2.EXCLUDED_PAIRS WHERE query_id = 'q13');
-- must be 0

-- How much each query's exclusion removes (feeds the writeup)
SELECT query_id, COUNT(*) AS removed FROM V2.EXCLUDED_PAIRS GROUP BY query_id ORDER BY query_id;
-- q14 (shellfish) would be 0 without the alias table

-- ⚠️ KNOWN FALSE POSITIVE — substring matching over-removes
SELECT r.title, r.ner FROM V2.EXCLUDED_PAIRS e JOIN raw.curated_recipes r USING (recipe_id)
WHERE e.query_id = 'q14' AND LOWER(r.ner) LIKE '%oyster mushroom%';
-- "oyster mushrooms" are fungi, not shellfish, but `oyster` matches them. Fail-closed
-- means false positives are the SAFE direction — we lose a dish rather than serve an
-- allergen. Documented rather than fixed: a negation list would be the start of the
-- allergen ontology this project explicitly refuses to build.

-- ------------------------------------------------------------
-- ④ Measured results
-- ------------------------------------------------------------
-- 2026-08-04, UDF over NER only (342-recipe corpus):
--   peanut 12 · almond 19 · shellfish 28 · cilantro 24 (unregistered term, still filters)
-- 2026-08-17, view over title+ingredients+NER, per frozen query:
--   q12 peanut 12 · q13 almond 22 · q14 shellfish 31 · q05 "heavy" 3
--   almond survivors 0 · oyster-mushroom false positive: Tom Yum only (has shrimp anyway)
--
-- q05 is the frozen parser's recorded leak (sql/09: "nothing heavy" → exclude ["heavy"]),
-- and here is what it costs: three recipes containing "heavy cream" (two tikka masalas, a
-- sorbet) are hard-excluded from a query that meant "not filling". An unregistered term
-- filters exactly as designed — the design just met a bad term. Left in: the parser is
-- frozen for the comparison, and this is what a frozen mistake looks like when measured.
--
-- Every recipe in the corpus has parseable NER, so the fail-closed-on-unknown branch
-- never fires here. The rule stays because a corpus without that guarantee is the
-- normal case, not the exception.
