-- ============================================================
-- 09_query_parser.sql — W2.3: craving text → concepts + exclusions → axis targets
-- ============================================================
-- Four design decisions, each derived by asking what breaks:
--
--   concepts = CLOSED vocabulary (enum of the wiki's concepts)
--       The LLM is already a synonym engine — it knows succulent ≈ juicy ≈ moist. The
--       enum is the landing pad that forces that knowledge onto vocabulary the wiki can
--       actually look up. Enumerating synonyms ourselves was the CRAVINGS dictionary we
--       already dropped: phrasings are infinite, concepts are not.
--
--   exclude = OPEN vocabulary (no enum)
--       Closing it would silently fail OPEN on the dangerous axis: "without cilantro"
--       with cilantro absent from the enum yields exclude:[] — "no constraint" — which
--       is the opposite of fail closed. Unregistered terms fall back to plain string
--       matching against NER and get logged for the alias table.
--
--   overlapping axes = MAX, not average
--       "warm brothy soup" maps warm from two concepts: warm→warm 1.0 (stated) and
--       brothy→warm 0.8 (side implication). Averaging lets a side implication drag down
--       an explicit request, so naming MORE concepts weakens the target. MAX keeps
--       "asked for it this strongly, at all" as the rule.
--       ⚠️ Known hole: refreshing→rich 0.0 means "not rich", and MAX with a conflicting
--       concept erases it. No current query combines them; revisit in W3 (PLAN "Open").
--
--   parse failure is not an error
--       Empty concepts → the caller falls back to V1 vector search. Imperfect beats empty.
--
-- ============================================================
-- 🔒 FROZEN 2026-08-03. W3 treats these parses as fixed input; changing the prompt
--    between the V1 and V2 measurements would invalidate the comparison.
--
-- Parse of all 15 eval queries at freeze time. The three that matter are intact:
--   q12 spicy + exclude:[peanut] · q13 comforting,sweet + exclude:[almond]
--   q14 warm,brothy + exclude:[shellfish]
--
-- Two known oddities, deliberately NOT fixed — recorded so W3's numbers can say whether
-- they matter. Prompt tuning here was already 3-for-4 and v1 burned a day on exactly
-- this loop.
--
--   1. exclude leaks sensory words. q05 "light and clean, nothing heavy" produced
--      concepts:[light, fresh] AND exclude:["heavy"]. exclude is an INGREDIENT filter;
--      "heavy" matches nothing in NER, so it is inert — but it shows the open-vocabulary
--      exclude field will accept non-ingredients. If W3 ever hard-fails on an unmatched
--      exclusion term instead of ignoring it, this becomes a real bug.
--
--   2. residual concept padding. q09 "sweet treat for a celebration" picked up `fresh`;
--      so did the probe "something my grandmother used to make" (comforting + fresh),
--      where comforting alone was right. Side effect of the instruction that occasion
--      words imply sensory concepts — the fix for q10's empty parse. One over-tagged
--      concept costs a little precision; q10 returning nothing cost the whole query.
--      Watch whether q09 underperforms in W3.
-- ============================================================

USE DATABASE CRAVING_RAG;
USE WAREHOUSE CRAVING_WH;

-- ------------------------------------------------------------
-- ① Parser as a function, so W3's scoring can call it per query
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION V2.PARSE_CRAVING(craving STRING)
RETURNS VARIANT
AS
$$
PARSE_JSON(AI_COMPLETE(
    model => 'mistral-large2',
    prompt => CONCAT(
        'Parse this food craving into concepts and exclusions.\n\n',
        'Return EVERY allowed concept the craving implies, not just the strongest one. ',
        '"rich comforting meal" is BOTH rich and comforting. ',
        'Occasion words imply sensory concepts: a summer picnic implies cold and fresh; ',
        'a cold day implies warm and comforting.\n',
        'concepts: pick ONLY from the allowed list. Choose the closest allowed concept ',
        'for what the user means — "succulent" or "moist" means juicy; "soup" or ',
        '"broth" means brothy; "hot" meaning temperature is warm, "hot" meaning chili ',
        'is spicy. If nothing in the list fits, return an empty list rather than ',
        'forcing a match.\n',
        'A NEGATED craving maps to its opposite concept, not to itself: ',
        '"not too heavy" is light, "not spicy" is mild, "nothing rich" is light.\n\n',
        'exclude: ingredients the user does not want, as singular lowercase nouns ',
        '("no peanuts" -> peanut). Any ingredient is allowed here, not just common ones. ',
        'Only list what the user actually refused — never infer dietary rules.\n\n',
        'Craving: ', craving
    ),
    model_parameters => {'max_tokens': 400},
    response_format => {
        'type': 'json',
        'schema': {'type':'object','properties':{
            'concepts': {'type':'array','items':{'type':'string','enum':[
                'refreshing','fresh','juicy','spicy','mild','warm','cold','brothy',
                'savory','sweet','rich','light','heavy','comforting','cozy','hearty',
                'indulgent','crispy','tender']}},
            'exclude':  {'type':'array','items':{'type':'string'}}},
            'required':['concepts','exclude']}
    }
))
$$;

-- ------------------------------------------------------------
-- ② Concepts → axis targets, via the wiki. MAX per axis.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION V2.CRAVING_TARGETS(craving STRING)
RETURNS TABLE (axis STRING, target FLOAT)
AS
$$
    SELECT w.axis, MAX(w.weight) AS target
    FROM TABLE(FLATTEN(input => V2.PARSE_CRAVING(craving):concepts)) c
    JOIN V2.SENSORY_WIKI w ON w.concept = c.value::string
    GROUP BY w.axis
$$;

-- ------------------------------------------------------------
-- ③ Done-when checks
-- ------------------------------------------------------------
-- The worked example from PLAN's architecture diagram
SELECT V2.PARSE_CRAVING('spicy warm soup, no peanuts') AS parsed;
--   expect concepts ~ [spicy, warm, brothy], exclude = ["peanut"]

SELECT * FROM TABLE(V2.CRAVING_TARGETS('spicy warm soup, no peanuts'));
--   expect warm = 1.0 (MAX of warm→1.0 and brothy→0.8), not 0.9

-- Unseen phrasing lands on a known concept (the v1 "squirts" failure, now handled)
SELECT V2.PARSE_CRAVING('something that squirts liquid when you bite it') AS parsed;
--   expect juicy — NOT an invented concept, NOT empty

-- Negation maps to the opposite concept, not to itself
SELECT V2.PARSE_CRAVING('light and clean, nothing heavy') AS parsed;
--   expect light (or fresh) — must NOT contain heavy. This is q05, which V1 scored 0.474
--   precisely because "nothing heavy" attracted heavy dishes.

-- Open-vocabulary exclusion: an ingredient with no alias-table entry still comes through
SELECT V2.PARSE_CRAVING('warm noodle soup without cilantro') AS parsed;
--   expect exclude = ["cilantro"] — proof the exclusion side is not enum-bound

-- Nothing matchable → empty concepts → caller uses vector fallback
SELECT V2.PARSE_CRAVING('something my grandmother used to make') AS parsed;
--   expect concepts = [] or a weak comforting; either is fine, an invented axis is not

-- All 15 eval queries at once — read the parses before trusting W3's numbers
SELECT q.query_id, q.category, q.query_text,
       V2.PARSE_CRAVING(q.query_text):concepts AS concepts,
       V2.PARSE_CRAVING(q.query_text):exclude  AS exclude
FROM EVAL2.QUERIES q
ORDER BY q.query_id;
--   q12/q13/q14 must have non-empty exclude — those are the queries V2 exists to fix.

-- Unregistered exclusion terms = the alias table's to-do list
SELECT DISTINCT e.value::string AS term
FROM EVAL2.QUERIES q,
     TABLE(FLATTEN(input => V2.PARSE_CRAVING(q.query_text):exclude)) e
WHERE NOT EXISTS (SELECT 1 FROM V2.EXCLUSION_ALIASES a WHERE a.canonical_term = e.value::string);
