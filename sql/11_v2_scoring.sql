-- ============================================================
-- 11_v2_scoring.sql — W3.2: V2 retrieval + the graph edges that fall out of it
-- ============================================================
-- Pipeline per query:
--   parse (09, frozen) → component filter → exclusion, fail closed (10)
--   → score survivors → rank + edges → vector fallback if nothing parsed
--
-- The structural claim: the scoring trace IS the explanation. Every V2_EDGES row is a
-- (craving → axis → dish) edge carrying its evidence; the UI renders, never invents.
--
-- Materialized tables, not nested UDFs — Snowflake rejects subqueries inside UDF bodies
-- ("Unsupported subquery type"), and tables are what W3.3 judges anyway. The LLM parse
-- runs 15 times total, in ①, never per row.
--
-- ============================================================
-- FINDINGS while building this (each found by a failing check, 2026-08-04):
--
-- 1. NER IS LOSSY — exclusion must search wider than it.
--    Marzipan's "1/4 lb. finely ground, blanched almonds" was extracted by RecipeNLG as
--    ["finely ground", ...] — the almond vanished, so NER-only filtering ranked Marzipan
--    #3 for "dessert without almonds". The filter now searches title + raw ingredients +
--    NER. Fail-closed on empty NER was never triggered (all 342 have NER); the failure
--    mode that actually bit was NER present-but-wrong, which no emptiness check catches.
--
-- 2. AVG OVER MATCHED AXES REWARDS IGNORANCE.
--    A dish matching 1 of 3 requested axes perfectly averaged 1.0 and beat dishes
--    matching all 3 at 0.9 — Miso Soup outranked kimchi jjigae for "spicy warm soup"
--    by not being measured on spicy at all. Score is now SUM(axis_score)/n_requested:
--    unmatched axes count as 0 toward the denominator. This deliberately bends the
--    fail-open rule at ranking time — unmeasured axes still don't exclude a dish, but
--    they no longer help it either.
--
-- 3. COMPONENTS ARE NOT DISHES — and the judging rules already said so.
--    "Jb Buffalo Wing Sauce" ranked #1 for "spicy dish without peanuts". JUDGING.md rule
--    4 scores components 0, so the system surfacing them is a designed-in loss. Title
--    heuristic: remove rows whose title ENDS with sauce/dressing/glaze/batter/stock/
--    wrapper/marinade/seasoning UNLESS it contains " with " or " and " — that keeps
--    "Carnitas With Red Sauce" (a dish) while dropping "Fish Taco Sauce" (a condiment).
--    Measured: 9 removed, 4 kept, all correctly. Known gap: "Massaman Curry Paste"
--    survives ("paste" not in the list) — add terms as they surface, not preemptively.
--
-- 4. TEXTURE AXIS DELIBERATELY DEFERRED.
--    q04 "crispy outside, tender inside" produces zero V2 candidates: no axis covers
--    texture (crispy/tender are gap notes by design). Rather than add a 9th axis
--    mid-measurement, empty-parse queries fall back to V1's vector ranking — the
--    "graph gives precision, embeddings give coverage" split, working as designed.
--    TRIGGER CONDITION for adding texture axes later: q04's fallback score in W3.3
--    materially trails its V1 baseline (0.855), or texture queries grow beyond one.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① Parse each eval query once. 15 LLM calls, then never again.
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL2.V2_PARSED AS
SELECT query_id, query_text, category,
       V2.PARSE_CRAVING(query_text) AS parsed
FROM EVAL2.QUERIES;

-- A NULL parse is the sporadic AI_COMPLETE failure seen in W2.1 and W2.3 — rerun ① if any.
SELECT COUNT(*) AS null_parses FROM EVAL2.V2_PARSED WHERE parsed IS NULL;

-- ------------------------------------------------------------
-- ② Edges: one row per (query, recipe, axis). Ranking and explanation, same rows.
-- ------------------------------------------------------------
CREATE OR REPLACE TABLE EVAL2.V2_EDGES AS
WITH intent AS (                       -- craving → axis targets, MAX per axis so a side
    SELECT p.query_id, w.axis, MAX(w.weight) AS target
    FROM EVAL2.V2_PARSED p, LATERAL FLATTEN(input => p.parsed:concepts) c
    JOIN V2.SENSORY_WIKI w ON w.concept = c.value::string
    GROUP BY p.query_id, w.axis
),
axis_count AS (SELECT query_id, COUNT(*) AS n_axes FROM intent GROUP BY query_id),
alias_map AS (
    SELECT canonical_term AS term, alias FROM V2.EXCLUSION_ALIASES
    UNION ALL SELECT DISTINCT canonical_term, canonical_term FROM V2.EXCLUSION_ALIASES
),
searchable AS (
    -- Finding 1: NER is lossy, so the exclusion haystack is title + raw ingredients + NER.
    -- Finding 3: the component heuristic lives here — a title ending in a component word
    -- is dropped unless " with "/" and " marks it as a dish served with that component.
    SELECT recipe_id,
           LOWER(COALESCE(title,'') || ' ' || COALESCE(ingredients,'') || ' ' || COALESCE(ner,'')) AS hay,
           ner
    FROM raw.curated_recipes
    WHERE NOT (LOWER(title) RLIKE '.*\\b(sauce|dressing|glaze|batter|stock|wrappers?|marinade|seasoning)\\s*$'
               AND NOT (LOWER(title) LIKE '% with %' OR LOWER(title) LIKE '% and %'))
),
excluded AS (                          -- fail closed: term or alias anywhere in the haystack
    SELECT DISTINCT p.query_id, s.recipe_id
    FROM EVAL2.V2_PARSED p
    JOIN searchable s
    JOIN LATERAL FLATTEN(input => p.parsed:exclude) t
    LEFT JOIN alias_map a ON a.term = LOWER(t.value::string)
    WHERE s.ner IS NULL OR LENGTH(TRIM(s.ner)) = 0
       OR s.hay LIKE '%' || LOWER(t.value::string) || '%'
       OR (a.alias IS NOT NULL AND s.hay LIKE '%' || a.alias || '%')
)
SELECT i.query_id, s2.recipe_id, s2.title, i.axis,
       s2.signals[i.axis]::float AS dish_value,
       i.target,
       1 - ABS(s2.signals[i.axis]::float - i.target) AS axis_score,
       s2.evidence[i.axis] AS evidence,
       ac.n_axes
FROM intent i
JOIN axis_count ac ON ac.query_id = i.query_id
JOIN V2.RECIPE_SIGNALS s2 ON s2.signals[i.axis] IS NOT NULL   -- fail open on unmeasured
JOIN searchable sr ON sr.recipe_id = s2.recipe_id             -- component filter applies
LEFT JOIN excluded e ON e.query_id = i.query_id AND e.recipe_id = s2.recipe_id
WHERE e.recipe_id IS NULL;                                    -- anti-join = hard filter

-- ------------------------------------------------------------
-- ③ Ranked runs + vector fallback, same shape as EVAL2.RUNS for identical judging
-- ------------------------------------------------------------
-- Finding 2: score = SUM(axis_score) / axes REQUESTED, not AVG over matched.
CREATE OR REPLACE TABLE EVAL2.V2_RUNS AS
SELECT query_id, 'V2_structured' AS arm, recipe_id, title,
       ROW_NUMBER() OVER (PARTITION BY query_id
                          ORDER BY SUM(axis_score)/MAX(n_axes) DESC, COUNT(*) DESC) AS rank,
       SUM(axis_score)/MAX(n_axes) AS score,
       COUNT(*) AS axes_matched, MAX(n_axes) AS axes_requested,
       FALSE AS is_fallback
FROM EVAL2.V2_EDGES
GROUP BY query_id, recipe_id, title
QUALIFY rank <= 10;

-- Finding 4: queries the axis system cannot express borrow V1's vector ranking.
INSERT INTO EVAL2.V2_RUNS
SELECT r.query_id, 'V2_structured', r.recipe_id, r.title, r.rank,
       NULL, 0, 0, TRUE
FROM EVAL2.RUNS r
WHERE r.query_id NOT IN (SELECT DISTINCT query_id FROM EVAL2.V2_RUNS);

-- ------------------------------------------------------------
-- ④ Done-when checks
-- ------------------------------------------------------------
-- 🎯 THE EXCLUSION TEST. V1 put Almond Cake at rank 1 here (NDCG 0.307).
SELECT rank, title, ROUND(score,3) AS score, axes_matched
FROM EVAL2.V2_RUNS WHERE query_id = 'q13' ORDER BY rank;
-- zero almond dishes must appear

-- q12: V1 ranked Kung Pao Chicken (peanuts) first
SELECT rank, title, ROUND(score,3) AS score FROM EVAL2.V2_RUNS WHERE query_id = 'q12' ORDER BY rank;

-- The exclusion actually removed something (compare candidate counts)
SELECT query_id, COUNT(DISTINCT recipe_id) AS candidates
FROM EVAL2.V2_EDGES GROUP BY query_id ORDER BY query_id;
-- q12/q13/q14 should be visibly smaller than sensory queries with similar axis counts

-- Edges carry evidence — this is what the UI renders
SELECT axis, dish_value, target, ROUND(axis_score,2) AS axis_score, evidence
FROM EVAL2.V2_EDGES
WHERE query_id = 'q01' AND title ILIKE '%Gochujang Kimchi%' ORDER BY axis;

-- Coverage: which queries produced no candidates at all → vector fallback territory
SELECT q.query_id, q.query_text, COUNT(DISTINCT e.recipe_id) AS candidates
FROM EVAL2.QUERIES q LEFT JOIN EVAL2.V2_EDGES e USING (query_id)
GROUP BY q.query_id, q.query_text HAVING candidates = 0;
-- q04 (crispy/tender) is the expected member: no axis covers texture, by design
