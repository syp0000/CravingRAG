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
-- ② The filter: is this recipe excluded by this set of terms?
-- ------------------------------------------------------------
-- FAIL CLOSED, twice over:
--   · unparseable/empty NER → excluded (cannot confirm absence)
--   · a matched alias → excluded, no scoring appeal
CREATE OR REPLACE FUNCTION V2.IS_EXCLUDED(ner STRING, terms ARRAY)
RETURNS BOOLEAN
AS
$$
    ARRAY_SIZE(terms) > 0
    AND (
        ner IS NULL OR LENGTH(TRIM(ner)) = 0        -- fail closed on unknown
        OR EXISTS (
            SELECT 1
            FROM TABLE(FLATTEN(input => terms)) t
            JOIN (
                SELECT canonical_term AS term, alias FROM V2.EXCLUSION_ALIASES
                UNION ALL
                SELECT DISTINCT canonical_term, canonical_term FROM V2.EXCLUSION_ALIASES
            ) a ON a.term = LOWER(t.value::string)
            WHERE LOWER(ner) LIKE '%' || a.alias || '%'
        )
        -- unregistered term: match the term itself (this is what makes "cilantro" work)
        OR EXISTS (
            SELECT 1 FROM TABLE(FLATTEN(input => terms)) t
            WHERE LOWER(ner) LIKE '%' || LOWER(t.value::string) || '%'
        )
    )
$$;

-- ------------------------------------------------------------
-- ③ Done-when checks
-- ------------------------------------------------------------
-- q13: zero almond dishes survive, and nothing with unknown almond status survives
SELECT COUNT(*) AS almond_survivors
FROM raw.curated_recipes
WHERE NOT V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('almond'))
  AND (LOWER(ner) LIKE '%almond%' OR LOWER(ner) LIKE '%frangipane%'
       OR LOWER(ner) LIKE '%marzipan%' OR LOWER(ner) LIKE '%amaretto%');
-- must be 0

-- How much does each exclusion actually remove? (feeds the W4 writeup)
SELECT 'peanut'    AS term, COUNT(*) AS removed FROM raw.curated_recipes
    WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('peanut'))
UNION ALL SELECT 'almond', COUNT(*) FROM raw.curated_recipes
    WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('almond'))
UNION ALL SELECT 'shellfish', COUNT(*) FROM raw.curated_recipes
    WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('shellfish'));
-- expect roughly 11 / 20 / 25 — if shellfish shows 0, the alias table did not load

-- Unregistered term still filters (the parser's open-vocabulary decision depends on this)
SELECT COUNT(*) AS cilantro_removed FROM raw.curated_recipes
WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('cilantro'));
-- must be > 0

-- Empty exclusion list removes nothing
SELECT COUNT(*) AS should_be_zero FROM raw.curated_recipes
WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT());

-- ⚠️ KNOWN FALSE POSITIVE — check what substring matching over-removes
SELECT title, ner FROM raw.curated_recipes
WHERE V2.IS_EXCLUDED(ner, ARRAY_CONSTRUCT('shellfish'))
  AND LOWER(ner) LIKE '%oyster mushroom%';
-- "oyster mushrooms" are fungi, not shellfish, but `oyster` matches them. Fail-closed
-- means false positives are the SAFE direction — we lose a dish rather than serve an
-- allergen. Documented rather than fixed: a negation list would be the start of the
-- allergen ontology this project explicitly refuses to build.
--
-- Measured 2026-08-04: exactly one hit, Tom Yum Soup — which contains shrimp anyway, so
-- the false positive changes no outcome here. Substring matching's cost is real but
-- currently zero on this corpus.

-- ------------------------------------------------------------
-- ④ Measured results, 2026-08-04 (342-recipe corpus)
-- ------------------------------------------------------------
--   almond survivors      0    ← the q13 contract holds
--   removed by peanut    12
--   removed by almond    19
--   removed by shellfish 28    ← would be 0 without the alias table
--   removed by cilantro  24    ← unregistered term, no alias entry, still filters
--   empty exclusion list  0
--
-- Every recipe in the corpus has parseable NER, so the fail-closed-on-unknown branch
-- never fires here. The rule stays because a corpus without that guarantee is the
-- normal case, not the exception.
