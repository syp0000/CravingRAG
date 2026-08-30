"""The live search pipeline: free-text craving → ranked recipes, as plain functions.

  parse_craving   ① V2.PARSE_CRAVING (live Cortex call) + AVOID chips
  intent_axes     ② wiki axes for the parsed concepts
  exclusion_needles  parsed terms + V2.EXCLUSION_ALIASES
  retrieve_candidates ③ one catalog pass: stored V1 vectors ranked, exclusions and
                     components annotated, eligible dishes counted
  rank            quality layer (search_quality.py): exclusions, components, identity,
                  drink format, dish-family dedupe; never pads to 5
  attach_details  ④ one bulk fetch of evidence + recipe text for the finalists
  search          runs the above, then ⑤ records provenance and one
                  ANALYTICS.SEARCH_EVENTS row (source = live_demo)

Every DB access goes through the `query` argument (default ui/db.q) so the whole
pipeline runs against a fake in tests. The frozen-parse rule applies to EVAL only;
the product parses live.
"""
import json
import sys

from search_quality import component_allowed, infer_intent
from search_quality import rejection as quality_rejection

from provenance.recommendation import recommendation_record
from provenance.recorder import get_recorder

RECORDER = get_recorder()   # CRAVING_DECISIONS=off|jsonl|semantica (default jsonl)
EMBED = "snowflake-arctic-embed-l-v2.0"
COMPONENT_RE_ANY = r".*\\b(paste|marinade|rub|seasoning|wrappers?|batter)\\b.*"
COMPONENT_RE_END = (r".*\\b(sauce|dressing|glaze|stock|broth|ketchup|mustard|mayonnaise|mayo|"
                    r"relish|syrup|jam|jelly|chutney|pesto|vinaigrette|dip|"
                    r"ganache|frosting|icing|filling|topping)\\s*$")
TOP_N = 5

# dial filters ride the extracted axes: what the measurement said axes are FOR.
# Fail open on NULL: an unmeasured axis neither qualifies nor disqualifies a dish,
# except hard demands (fire / rich) which require measured evidence.
SPICE_COND = {
    "none":   "AND (signals:spicy IS NULL OR signals:spicy <= 0.2)",
    "mild":   "AND (signals:spicy IS NULL OR signals:spicy <= 0.5)",
    "medium": "AND signals:spicy >= 0.3",
    "fire":   "AND signals:spicy >= 0.6",
}
RICH_COND = {
    "light": "AND (signals:rich IS NULL OR signals:rich <= 0.35)",
    "rich":  "AND signals:rich >= 0.6",
}
SUPPLY_AXES = {"spicy", "warm", "brothy", "savory", "rich", "fresh", "sweet", "comforting"}


def _default_query(sql, params=None):
    import db
    return db.q(sql, params)


def parse_craving(text, avoid, query):
    parsed = json.loads(query("SELECT V2.PARSE_CRAVING(%s)", (text,))[0][0] or "{}")
    concepts = parsed.get("concepts") or []
    excludes = [e.lower() for e in (parsed.get("exclude") or [])]
    # AVOID chips merge into the same exclusion machinery as parsed excludes
    for a in (avoid or []):
        if a and a.lower() not in excludes:
            excludes.append(a.lower())
    return concepts, excludes


def embed_text(text, cuisines):
    # CUISINE chips augment the embedding text: vectors carry identity well (measured),
    # and the 19.7k scale rows have no cuisine tag to filter on. Honest query expansion.
    return text + ((" . " + " or ".join(cuisines) + " cuisine") if cuisines else "")


def intent_axes(concepts, query):
    if not concepts:
        return {}
    ph = ",".join(["%s"] * len(concepts))
    return {axis: float(w) for axis, w in query(
        f"SELECT axis, MAX(weight) FROM V2.SENSORY_WIKI WHERE concept IN ({ph}) GROUP BY axis",
        concepts)}


def exclusion_needles(excludes, query):
    # term itself + registered aliases (same rule as V2.EXCLUDED_PAIRS). The catalog
    # scan happens inside the ranking query; never fetch one row per recipe into Python.
    needles = list(excludes)
    if excludes:
        ph = ",".join(["%s"] * len(excludes))
        needles += [a for (a,) in query(
            f"SELECT alias FROM V2.EXCLUSION_ALIASES WHERE canonical_term IN ({ph})", excludes)]
    return needles


def supply_fit(axes):
    # Keep live candidate_count consistent with ANALYTICS.CANDIDATE_COUNT: strong
    # parsed axes constrain supply, mid-strength implications do not.
    conds = []
    for axis, target in axes.items():
        if axis not in SUPPLY_AXES:
            continue
        if target >= 0.6:
            conds.append(f"signals:{axis}::float >= 0.6")
        elif target <= 0.2:
            conds.append(f"COALESCE(signals:{axis}::float, 0) <= 0.35")
    return " AND ".join(conds) or "TRUE"


def retrieve_candidates(embed, needles, axes, spice, rich, query):
    """One database pass: exclusion/component annotations, vector ranking, and the
    analytics candidate count. Only the best 200 lightweight rows cross into Python.
    Returns (rows, candidate_count, excluded_count, component_count)."""
    conds = SPICE_COND.get(spice or "", "") + " " + RICH_COND.get(rich or "", "")
    needle_case = " ".join("WHEN hay LIKE '%%' || %s || '%%' THEN %s" for _ in needles)
    matched_expr = f"CASE {needle_case} END" if needles else "NULL::STRING"
    flat_params = [p for needle in needles for p in (needle, needle)]
    rows = query(f"""
        WITH embedded AS (
          SELECT AI_EMBED('{EMBED}', %s) AS qv
        ), catalog AS (
          SELECT recipe_id,
                 LOWER(COALESCE(title,'')||' '||COALESCE(ingredients,'')||' '||COALESCE(ner,'')) AS hay,
                 (LOWER(title) RLIKE '{COMPONENT_RE_ANY}'
                  OR (LOWER(title) RLIKE '{COMPONENT_RE_END}'
                      AND NOT (LOWER(title) LIKE '%% with %%' OR LOWER(title) LIKE '%% and %%'))) AS is_component
          FROM raw.curated_recipes
        ), annotated AS (
          SELECT v.recipe_id, v.title, s.signals, v.flavor_profile,
                 ROUND(VECTOR_COSINE_SIMILARITY(v.profile_vec, e.qv), 4) AS sim,
                 c.is_component,
                 {matched_expr} AS matched
          FROM V1.RECIPE_PROFILES v
          JOIN V2.RECIPE_SIGNALS s USING (recipe_id)
          JOIN catalog c USING (recipe_id)
          CROSS JOIN embedded e
        ), ranked AS (
          SELECT recipe_id, title, sim, is_component, matched, flavor_profile
          FROM annotated
          WHERE TRUE {conds}
          ORDER BY sim DESC
          LIMIT 200
        ), stats AS (
          SELECT COUNT_IF(NOT is_component AND matched IS NULL AND {supply_fit(axes)}) AS candidate_count,
                 COUNT_IF(matched IS NOT NULL) AS excluded_count,
                 COUNT_IF(is_component) AS component_count
          FROM annotated
        )
        SELECT r.recipe_id, r.title, r.sim, r.is_component, r.matched, r.flavor_profile,
               s.candidate_count, s.excluded_count, s.component_count
        FROM stats s
        LEFT JOIN ranked r ON TRUE
        ORDER BY r.sim DESC""", [embed, *flat_params])
    counts = tuple(int(rows[0][i] or 0) if rows else 0 for i in (6, 7, 8))
    return rows, *counts


def rank(candidate_rows, intent):
    """Lean V3 quality layer. Fewer than 5 defensible answers → fewer than 5 results,
    never padding. Returns (ranked, rejected, considered, excluded_sample, component_sample)."""
    ranked, rejected, considered = [], [], 0
    excluded_sample, component_sample = [], []
    kept = []   # (recipe_id, title) survivors, cited by duplicate_dish rejections
    for rid, title, sim, is_component, matched, profile, *_ in candidate_rows:
        if rid is None:  # stats still returns one row when ranking found nothing
            continue
        rid = int(rid)
        considered += 1
        if matched:
            excluded_sample.append({"recipe_id": rid, "matched": matched})
        if is_component:
            component_sample.append(rid)
        why = f"excluded:{matched}" if matched else None
        if why is None and is_component and not component_allowed(title, intent):
            why = "component"
        if why is None:
            why = quality_rejection(title, profile, intent, kept)
        if why:
            rejected.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim), "why": why})
            continue
        kept.append((rid, title))
        ranked.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim)})
        if len(ranked) == TOP_N:
            break
    return ranked, rejected, considered, excluded_sample, component_sample


def attach_details(ranked, axes, query):
    """All finalist evidence and recipe content in one round trip."""
    details = {}
    if ranked:
        ph = ",".join(["%s"] * len(ranked))
        for rid, ingredients, directions, signals, evidence in query(f"""
            SELECT c.recipe_id, c.ingredients, c.directions, s.signals, s.evidence
            FROM raw.curated_recipes c
            JOIN V2.RECIPE_SIGNALS s USING (recipe_id)
            WHERE c.recipe_id IN ({ph})""", [d["recipe_id"] for d in ranked]):
            details[int(rid)] = (ingredients, directions, signals, evidence)
    for d in ranked:
        d["edges"] = []
        ing, dirs, sig, ev = details.get(d["recipe_id"], ("[]", "[]", "{}", "{}"))
        try:
            sig = json.loads(sig or "{}"); ev = json.loads(ev or "{}")
            d["ingredients"] = json.loads(ing or "[]")
            d["directions"] = json.loads(dirs or "[]")
        except (TypeError, json.JSONDecodeError):
            sig, ev, d["ingredients"], d["directions"] = {}, {}, [], []
        for axis, target in sorted(axes.items()):
            if sig.get(axis) is not None:
                d["edges"].append({"axis": axis, "value": float(sig[axis]), "target": target,
                                   "evidence": ev.get(axis, [])[:3]})


def record_search_event(text, concepts, axes, excludes, candidate_count, query):
    """Same schema the synthetic generator writes (sql/15), labeled live_demo. No
    scenario, no authored intent: nobody authored a real person's craving."""
    query("""INSERT INTO ANALYTICS.SEARCH_EVENTS
         SELECT UUID_STRING(), CURRENT_TIMESTAMP(), %s, NULL, NULL,
                PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s)::array, %s,
                'live_demo', NULL, NULL""",
      (text, json.dumps(concepts), json.dumps(axes), json.dumps(excludes),
       candidate_count))


def search(text, cuisines=None, avoid=None, spice=None, rich=None, query=None):
    query = query or _default_query
    concepts, excludes = parse_craving(text, avoid, query)
    axes = intent_axes(concepts, query)
    needles = exclusion_needles(excludes, query)
    rows, candidate_count, excluded_count, component_count = retrieve_candidates(
        embed_text(text, cuisines), needles, axes, spice, rich, query)
    # NOTE candidate_count is pre-quality-layer (matches ANALYTICS mart).
    intent = infer_intent(text)
    ranked, rejected, considered, excluded_sample, component_sample = rank(rows, intent)
    attach_details(ranked, axes, query)
    result = {"query": text, "concepts": concepts, "excludes": excludes,
              "params": {"cuisines": cuisines or [], "spice": spice, "rich": rich},
              "axes": [{"axis": a, "target": t} for a, t in sorted(axes.items())],
              # Samples support the decision trace without returning the whole catalog.
              # The scalar counts are exact and drive the UI.
              "excluded": excluded_sample, "excluded_count": excluded_count,
              "components": component_sample, "component_count": component_count,
              "candidate_count": candidate_count,
              # Lean V3: what the quality layer read out of the query (drives the
              # INTERPRETED AS chip; rejection counts live in the /why record)
              "interpretation": {"required_identity": sorted(intent["required_identity"]),
                                 "drink_allowed": intent["drink_ok"],
                                 "requested_components": sorted(intent["requested_components"])},
              "top": ranked}
    try:   # provenance is a side note; a broken notebook must never break a search
        result["decision_id"] = RECORDER.record(recommendation_record(result, rejected, considered, needles))
    except Exception as e:
        print(f"decision not recorded: {e}", file=sys.stderr)
    try:   # demand side: this real search becomes one ANALYTICS.SEARCH_EVENTS row (source=live_demo)
        record_search_event(text, concepts, axes, excludes, candidate_count, query)
    except Exception as e:
        print(f"search event not recorded: {e}", file=sys.stderr)
    return result
