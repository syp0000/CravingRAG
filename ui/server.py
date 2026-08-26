"""CravingRAG demo server — free-text craving → live Snowflake pipeline → JSON.

One stdlib HTTP server, two endpoints:
  GET /            → ui/app/dist (the React build; `npm run build` in ui/app)
  GET /media/…     → public/media videos and posters, same dist
  GET /catalog     → all recipes (id, title) for the star field
  GET /diagrams/…  → archify diagrams from docs/diagrams (About page embed)
  GET /why?id=…    → the decision record + its causal chain, as a page
  GET /gaps        → ANALYTICS.DEMAND_SUPPLY_GAPS (sql/16) for the Catalog page
  GET /search?q=…  → runs the REAL pipeline for an arbitrary craving:
                     ① V2.PARSE_CRAVING (live Cortex call)
                     ② exclusion needles = parsed terms + V2.EXCLUSION_ALIASES
                     ③ ranking = the measured winner arm (V1 profile vectors
                        + hard exclusion + component filter; NDCG@5 0.844 on the
                        342-recipe dev corpus — the 20k live corpus is not re-judged)
                     ④ axis evidence for the top dishes from V2.RECIPE_SIGNALS
                     ⑤ one row into ANALYTICS.SEARCH_EVENTS, source = live_demo
The frozen-parse rule applies to EVAL only; the product parses live.

Usage:  .venv/bin/python ui/server.py   → http://localhost:8642
"""
import html
import json
import sys
import tomllib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import snowflake.connector

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))
from provenance.recommendation import recommendation_record  # noqa: E402
from provenance.recorder import get_recorder                 # noqa: E402

RECORDER = get_recorder()   # CRAVING_DECISIONS=off|jsonl|semantica (default jsonl)
EMBED = "snowflake-arctic-embed-l-v2.0"
COMPONENT_RE_ANY = r".*\\b(paste|marinade|rub|seasoning|wrappers?|batter)\\b.*"
COMPONENT_RE_END = (r".*\\b(sauce|dressing|glaze|stock|broth|ketchup|mustard|mayonnaise|mayo|"
                    r"relish|syrup|jam|jelly|chutney|pesto|vinaigrette|dip)\\s*$")

with open(ROOT.parent / ".dlt/secrets.toml", "rb") as f:
    CRED = tomllib.load(f)["destination"]["snowflake"]["credentials"]


def connect():
    return snowflake.connector.connect(
        account=CRED["host"], user=CRED["username"],
        private_key_file=CRED["private_key_path"], warehouse=CRED["warehouse"],
        database=CRED["database"], role=CRED["role"], schema="EVAL2",
    )


CONN = connect()


def q(sql, params=None):
    # one retry on a fresh connection — covers dead cursors AND dead executes
    global CONN
    try:
        cur = CONN.cursor()
        cur.execute(sql, params or ())
    except Exception:
        CONN = connect()
        cur = CONN.cursor()
        cur.execute(sql, params or ())
    return cur.fetchall()


def search(text, cuisines=None, avoid=None, spice=None, rich=None):
    parsed = json.loads(q("SELECT V2.PARSE_CRAVING(%s)", (text,))[0][0] or "{}")
    concepts = parsed.get("concepts") or []
    excludes = [e.lower() for e in (parsed.get("exclude") or [])]
    # AVOID chips merge into the same exclusion machinery as parsed excludes
    for a in (avoid or []):
        if a and a.lower() not in excludes:
            excludes.append(a.lower())
    # CUISINE chips augment the embedding text: vectors carry identity well (measured),
    # and the 19.7k scale rows have no cuisine tag to filter on. Honest query expansion.
    embed_text = text + ((" . " + " or ".join(cuisines) + " cuisine") if cuisines else "")

    # intent axes from the wiki
    axes = {}
    if concepts:
        ph = ",".join(["%s"] * len(concepts))
        for axis, w in q(f"SELECT axis, MAX(weight) FROM V2.SENSORY_WIKI WHERE concept IN ({ph}) GROUP BY axis", concepts):
            axes[axis] = float(w)

    # exclusion needles: term itself + registered aliases (same rule as V2.EXCLUDED_PAIRS)
    needles = list(excludes)
    if excludes:
        ph = ",".join(["%s"] * len(excludes))
        needles += [a for (a,) in q(
            f"SELECT alias FROM V2.EXCLUSION_ALIASES WHERE canonical_term IN ({ph})", excludes)]

    # per-recipe: excluded? component? — drives the star-death animation
    needle_case = " ".join(
        f"WHEN hay LIKE '%%' || %s || '%%' THEN %s" for _ in needles)
    flat_params = [p for n in needles for p in (n, n)]
    rows = q(f"""
        WITH hay AS (
          SELECT recipe_id, title,
                 LOWER(COALESCE(title,'')||' '||COALESCE(ingredients,'')||' '||COALESCE(ner,'')) AS hay,
                 (LOWER(title) RLIKE '{COMPONENT_RE_ANY}'
                  OR (LOWER(title) RLIKE '{COMPONENT_RE_END}'
                      AND NOT (LOWER(title) LIKE '%% with %%' OR LOWER(title) LIKE '%% and %%'))) AS is_component
          FROM raw.curated_recipes)
        SELECT recipe_id, is_component,
               {f"CASE {needle_case} END" if needles else "NULL"} AS matched
        FROM hay""", flat_params)
    comp = {int(r): bool(c) for r, c, m in rows}
    excl = {int(r): m for r, c, m in rows if m}

    # dial filters ride the extracted axes: what the measurement said axes are FOR.
    # Fail open on NULL: an unmeasured axis neither qualifies nor disqualifies a dish,
    # except hard demands (fire / rich) which require measured evidence.
    SPICE_COND = {
        "none":   "AND (s.signals:spicy IS NULL OR s.signals:spicy <= 0.2)",
        "mild":   "AND (s.signals:spicy IS NULL OR s.signals:spicy <= 0.5)",
        "medium": "AND s.signals:spicy >= 0.3",
        "fire":   "AND s.signals:spicy >= 0.6",
    }
    RICH_COND = {
        "light": "AND (s.signals:rich IS NULL OR s.signals:rich <= 0.35)",
        "rich":  "AND s.signals:rich >= 0.6",
    }
    conds = SPICE_COND.get(spice or "", "") + " " + RICH_COND.get(rich or "", "")

    # winner-arm ranking: profile vector cosine, filters applied (embed evaluated ONCE)
    top = q(f"""
        SELECT v.recipe_id, v.title,
               ROUND(VECTOR_COSINE_SIMILARITY(v.profile_vec, e.qv), 4) AS sim
        FROM V1.RECIPE_PROFILES v
        JOIN V2.RECIPE_SIGNALS s USING (recipe_id)
        CROSS JOIN (SELECT AI_EMBED('{EMBED}', %s) AS qv) e
        WHERE TRUE {conds}
        ORDER BY sim DESC
        LIMIT 200""", (embed_text,))
    # ponytail: 200 candidates for a top-5 after dedupe/exclusion/component drops;
    # raise if a heavy-exclusion query ever returns fewer than 5
    ranked, seen, rejected, considered = [], set(), [], 0
    for rid, title, sim in top:
        rid = int(rid)
        considered += 1
        # UI-only dedupe by normalized title (Siyeon's call): three "Hot And Sour Soup"
        # stars tell the viewer nothing — eval keeps every row, the sky keeps one per name
        name = " ".join(title.lower().split())
        why = (f"excluded:{excl[rid]}" if rid in excl else "component" if comp.get(rid)
               else "duplicate_title" if name in seen else None)
        if why:
            rejected.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim), "why": why})
            continue
        seen.add(name)
        ranked.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim)})
        if len(ranked) == 5:
            break

    # axis evidence + the recipe itself for the finalists
    for d in ranked:
        d["edges"] = []
        if axes:
            for (sig, ev) in q("SELECT signals, evidence FROM V2.RECIPE_SIGNALS WHERE recipe_id=%s", (d["recipe_id"],)):
                sig = json.loads(sig or "{}"); ev = json.loads(ev or "{}")
                for axis, target in sorted(axes.items()):
                    if sig.get(axis) is not None:
                        d["edges"].append({"axis": axis, "value": float(sig[axis]), "target": target,
                                           "evidence": ev.get(axis, [])[:3]})
        for (ing, dirs) in q("SELECT ingredients, directions FROM raw.curated_recipes WHERE recipe_id=%s", (d["recipe_id"],)):
            try:
                d["ingredients"] = json.loads(ing)
                d["directions"] = json.loads(dirs)
            except Exception:
                d["ingredients"], d["directions"] = [], []
    result = {"query": text, "concepts": concepts, "excludes": excludes,
              "params": {"cuisines": cuisines or [], "spice": spice, "rich": rich},
              "axes": [{"axis": a, "target": t} for a, t in sorted(axes.items())],
              "excluded": [{"recipe_id": r, "matched": m} for r, m in excl.items()],
              "components": [r for r, c in comp.items() if c],
              "top": ranked}
    try:   # provenance is a side note; a broken notebook must never break a search
        result["decision_id"] = RECORDER.record(recommendation_record(result, rejected, considered, needles))
    except Exception as e:
        print(f"decision not recorded: {e}", file=sys.stderr)
    try:   # demand side: this real search becomes one ANALYTICS.SEARCH_EVENTS row (source=live_demo)
        record_search_event(text, concepts, axes, excludes)
    except Exception as e:
        print(f"search event not recorded: {e}", file=sys.stderr)
    return result


def record_search_event(text, concepts, axes, excludes):
    """Same schema the synthetic generator writes (sql/15), labeled live_demo. No
    scenario, no authored intent: nobody authored a real person's craving."""
    q("""INSERT INTO ANALYTICS.SEARCH_EVENTS
         SELECT UUID_STRING(), CURRENT_TIMESTAMP(), %s, NULL, NULL,
                PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s)::array,
                ANALYTICS.CANDIDATE_COUNT(PARSE_JSON(%s), PARSE_JSON(%s)::array),
                'live_demo', NULL, NULL""",
      (text, json.dumps(concepts), json.dumps(axes), json.dumps(excludes),
       json.dumps(axes), json.dumps(excludes)))


def gaps():
    """Catalog Intelligence: the mart (sql/16) plus how much live traffic exists."""
    cols = ["scenario_id", "intent_key", "search_count", "demand_share", "matching_dishes",
            "supply_share", "opportunity_index", "avg_candidate_count", "low_coverage_rate",
            "demand_source", "generator_version", "seed"]
    rows = q(f"SELECT {', '.join(cols)} FROM ANALYTICS.DEMAND_SUPPLY_GAPS ORDER BY opportunity_index DESC")
    live = q("""SELECT COUNT(*), MIN(candidate_count), ROUND(AVG(candidate_count))
                FROM ANALYTICS.SEARCH_EVENTS WHERE source='live_demo'""")[0]
    defs = q("SELECT intent_key, target_axes, matching_dishes, catalog_size FROM ANALYTICS.INTENT_DEFS ORDER BY matching_dishes")
    return {"gaps": [dict(zip(cols, (float(v) if hasattr(v, "as_integer_ratio") else v for v in r))) for r in rows],
            "intents": [{"intent_key": k, "target_axes": json.loads(t), "matching_dishes": int(m), "catalog_size": int(n)}
                        for k, t, m, n in defs],
            "live": {"searches": int(live[0]), "min_candidates": live[1] and int(live[1]),
                     "avg_candidates": live[2] and int(live[2])}}


def why_page(rec_id):
    """One decision, human-readable: the chain it followed from, then the record."""
    rec = RECORDER.get(rec_id)
    if rec is None:
        return None
    e = html.escape
    chain = RECORDER.trace(rec_id)
    out = ["<!doctype html><meta charset=utf-8><title>why · CravingRAG</title>",
           "<style>body{background:#0a0b0e;color:#d8d8d8;font:14px/1.5 ui-monospace,Menlo,monospace;"
           "max-width:900px;margin:40px auto;padding:0 20px}h2{color:#e8b04b;font-size:13px;letter-spacing:.2em}"
           "li{margin:4px 0}.dim{color:#777}.no{color:#e05a5a}.ok{color:#6cc47a}pre{white-space:pre-wrap;color:#999}</style>",
           f"<h1 style='font-size:16px'>WHY · {e(rec_id)}</h1>",
           "<h2>CHAIN (root first)</h2><ol>"]
    out += [f"<li><span class=dim>[{e(r['kind'])}]</span> {e(r['summary'])}"
            + (f"<br><span class=dim>{e(r['reasoning'])}</span>" if r.get("reasoning") else "") + "</li>" for r in chain]
    out.append("</ol>")
    if rec.get("kind") == "recommendation":
        pref, con = rec["preferences"], rec["constraints"]
        out += [f"<h2>QUERY</h2><p>{e(rec['query'])}</p>",
                f"<h2>PREFERENCES</h2><p>concepts: {e(', '.join(pref['concepts']) or 'none (vector fallback)')}"
                f"<br>axes: {e(', '.join(f'{a['axis']} {a['target']}' for a in pref['axes']) or 'none')}</p>",
                f"<h2>CONSTRAINTS</h2><p>excludes: {e(', '.join(con['excludes']) or 'none')}"
                f"<br>needles searched: {e(', '.join(con['needles']) or 'none')}</p>",
                f"<h2>CANDIDATES · {rec['candidates_considered']} looked at, {len(rec['rejected'])} rejected</h2><ul>"]
        out += [f"<li class=no>✗ {e(r['title'])} <span class=dim>sim {r['sim']} · {e(r['why'])}</span></li>" for r in rec["rejected"]]
        out.append("</ul><h2>SELECTED</h2><ol>")
        for d in rec["selected"]:
            ev = "".join(f"<br><span class=dim>{e(x['axis'])} {x['value']} ← “{e((x['evidence'] or ['no evidence'])[0])}”</span>"
                         for x in (d.get("edges") or []))
            out.append(f"<li class=ok>{e(d['title'])} <span class=dim>sim {d['sim']}</span>{ev}</li>")
        out.append(f"</ol><h2>OUTCOME</h2><p>{e(rec['outcome'])} · confidence {rec['confidence']} "
                   f"<span class=dim>({e(rec['confidence_basis'])})</span></p>")
    out.append(f"<h2>RAW</h2><pre>{e(json.dumps(rec, indent=1, ensure_ascii=False))}</pre>")
    return "".join(out)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ctype):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")   # hashed assets change on every build
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        dist = ROOT / "app" / "dist"
        try:
            if u.path == "/":
                self.send_file(dist / "index.html", "text/html; charset=utf-8")
            elif u.path.startswith(("/assets/", "/media/")) or u.path in ("/favicon.svg", "/icons.svg"):
                # everything Vite copies into dist: hashed bundles, public/media videos, icons
                f = (dist / u.path.lstrip("/")).resolve()
                if not f.is_relative_to(dist.resolve()) or not f.is_file():
                    return self.send_json({"error": "not found"}, 404)
                ctype = {"js": "text/javascript", "css": "text/css", "mp4": "video/mp4", "png": "image/png",
                         "svg": "image/svg+xml"}.get(f.suffix.lstrip("."), "application/octet-stream")
                self.send_file(f, ctype)
            elif u.path.startswith("/diagrams/"):     # archify HTML from docs/diagrams
                f = (ROOT.parent / "docs" / "diagrams" / u.path[len("/diagrams/"):]).resolve()
                if f.suffix != ".html" or not f.is_relative_to((ROOT.parent / "docs" / "diagrams").resolve()) or not f.is_file():
                    return self.send_json({"error": "not found"}, 404)
                self.send_file(f, "text/html; charset=utf-8")
            elif u.path == "/why":
                page = why_page((parse_qs(u.query).get("id") or [""])[0])
                if page is None:
                    return self.send_json({"error": "unknown decision id"}, 404)
                body = page.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif u.path == "/gaps":
                self.send_json(gaps())
            elif u.path == "/catalog":
                rows = q("SELECT recipe_id, title FROM raw.curated_recipes ORDER BY recipe_id")
                self.send_json([{"recipe_id": int(r), "title": t.strip()} for r, t in rows])
            elif u.path == "/search":
                qs = parse_qs(u.query)
                text = (qs.get("q") or [""])[0].strip()
                if not text:
                    return self.send_json({"error": "empty query"}, 400)
                cuisines = [c for c in (qs.get("cuisine") or [""])[0].split(",") if c]
                avoid = [a for a in (qs.get("avoid") or [""])[0].split(",") if a]
                spice = (qs.get("spice") or [None])[0]
                rich = (qs.get("rich") or [None])[0]
                self.send_json(search(text, cuisines, avoid, spice, rich))
            else:
                self.send_json({"error": "not found"}, 404)
        except Exception as e:  # surface errors to the UI during the demo, don't die
            self.send_json({"error": str(e)}, 500)


if __name__ == "__main__":
    q("SELECT 1")  # warm the warehouse before the first real query
    print("CravingRAG live on http://localhost:8642")
    ThreadingHTTPServer(("127.0.0.1", 8642), H).serve_forever()
