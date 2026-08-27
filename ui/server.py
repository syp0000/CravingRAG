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
                     ③ one catalog pass ranks stored V1 profile vectors, annotates
                        hard exclusions/components, and counts eligible dishes
                     ④ one bulk fetch adds stored evidence and recipe text to the five
                        finalists (the AI never rereads the catalog at search time)
                     ⑤ one row into ANALYTICS.SEARCH_EVENTS, source = live_demo,
                        reusing the candidate count from step ③
The frozen-parse rule applies to EVAL only; the product parses live.

Usage:  .venv/bin/python ui/server.py   → http://localhost:8642
"""
import html
import json
import os
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

def _connect_kwargs():
    """Local dev reads .dlt/secrets.toml (private key on disk). A deployed host has no
    such file, so when SNOWFLAKE_ACCOUNT is set the credentials come from env vars and the
    private key travels as inline PEM in SNOWFLAKE_PRIVATE_KEY."""
    base = dict(schema="EVAL2")
    if os.environ.get("SNOWFLAKE_ACCOUNT"):
        from cryptography.hazmat.primitives import serialization  # ships with the connector
        pwd = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PWD") or None
        key = serialization.load_pem_private_key(
            os.environ["SNOWFLAKE_PRIVATE_KEY"].encode(),
            password=pwd.encode() if pwd else None)
        base.update(
            account=os.environ["SNOWFLAKE_ACCOUNT"], user=os.environ["SNOWFLAKE_USER"],
            warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "CRAVING_WH"),
            database=os.environ.get("SNOWFLAKE_DATABASE", "CRAVING_RAG"),
            role=os.environ.get("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
            private_key=key.private_bytes(serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return base
    with open(ROOT.parent / ".dlt/secrets.toml", "rb") as f:
        c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
    base.update(account=c["host"], user=c["username"], private_key_file=c["private_key_path"],
                warehouse=c["warehouse"], database=c["database"], role=c["role"])
    if c.get("private_key_passphrase"):
        base["private_key_file_pwd"] = c["private_key_passphrase"]
    return base


CONN_KWARGS = _connect_kwargs()


def connect():
    return snowflake.connector.connect(**CONN_KWARGS)


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

    # Exclusion needles: term itself + registered aliases (same rule as
    # V2.EXCLUDED_PAIRS). The catalog scan happens later, inside the ranking query;
    # never fetch one annotation row per recipe into Python.
    needles = list(excludes)
    if excludes:
        ph = ",".join(["%s"] * len(excludes))
        needles += [a for (a,) in q(
            f"SELECT alias FROM V2.EXCLUSION_ALIASES WHERE canonical_term IN ({ph})", excludes)]

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
    conds = SPICE_COND.get(spice or "", "") + " " + RICH_COND.get(rich or "", "")

    # One database pass now does the work that used to take three full catalog
    # passes: exclusion/component annotations, vector ranking, and the analytics
    # candidate count. Only the best 200 lightweight rows cross into Python.
    needle_case = " ".join(
        "WHEN hay LIKE '%%' || %s || '%%' THEN %s" for _ in needles)
    matched_expr = f"CASE {needle_case} END" if needles else "NULL::STRING"
    flat_params = [p for needle in needles for p in (needle, needle)]

    # Keep live candidate_count consistent with ANALYTICS.CANDIDATE_COUNT: strong
    # parsed axes constrain supply, mid-strength implications do not.
    supply_conds = []
    for axis, target in axes.items():
        if axis not in {"spicy", "warm", "brothy", "savory", "rich", "fresh", "sweet", "comforting"}:
            continue
        if target >= 0.6:
            supply_conds.append(f"signals:{axis}::float >= 0.6")
        elif target <= 0.2:
            supply_conds.append(f"COALESCE(signals:{axis}::float, 0) <= 0.35")
    supply_fit = " AND ".join(supply_conds) or "TRUE"

    candidate_rows = q(f"""
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
          SELECT v.recipe_id, v.title, s.signals,
                 ROUND(VECTOR_COSINE_SIMILARITY(v.profile_vec, e.qv), 4) AS sim,
                 c.is_component,
                 {matched_expr} AS matched
          FROM V1.RECIPE_PROFILES v
          JOIN V2.RECIPE_SIGNALS s USING (recipe_id)
          JOIN catalog c USING (recipe_id)
          CROSS JOIN embedded e
        ), ranked AS (
          SELECT recipe_id, title, sim, is_component, matched
          FROM annotated
          WHERE TRUE {conds}
          ORDER BY sim DESC
          LIMIT 200
        ), stats AS (
          SELECT COUNT_IF(NOT is_component AND matched IS NULL AND {supply_fit}) AS candidate_count,
                 COUNT_IF(matched IS NOT NULL) AS excluded_count,
                 COUNT_IF(is_component) AS component_count
          FROM annotated
        )
        SELECT r.recipe_id, r.title, r.sim, r.is_component, r.matched,
               s.candidate_count, s.excluded_count, s.component_count
        FROM stats s
        LEFT JOIN ranked r ON TRUE
        ORDER BY r.sim DESC""", [embed_text, *flat_params])

    candidate_count = int(candidate_rows[0][5] or 0) if candidate_rows else 0
    excluded_count = int(candidate_rows[0][6] or 0) if candidate_rows else 0
    component_count = int(candidate_rows[0][7] or 0) if candidate_rows else 0
    # ponytail: 200 candidates for a top-5 after dedupe/exclusion/component drops;
    # raise if a heavy-exclusion query ever returns fewer than 5
    ranked, seen, rejected, considered = [], set(), [], 0
    excluded_sample, component_sample = [], []
    for rid, title, sim, is_component, matched, *_ in candidate_rows:
        if rid is None:  # stats still returns one row when ranking found nothing
            continue
        rid = int(rid)
        considered += 1
        if matched:
            excluded_sample.append({"recipe_id": rid, "matched": matched})
        if is_component:
            component_sample.append(rid)
        # UI-only dedupe by normalized title (Siyeon's call): three "Hot And Sour Soup"
        # stars tell the viewer nothing — eval keeps every row, the sky keeps one per name
        name = " ".join(title.lower().split())
        why = (f"excluded:{matched}" if matched else "component" if is_component
               else "duplicate_title" if name in seen else None)
        if why:
            rejected.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim), "why": why})
            continue
        seen.add(name)
        ranked.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim)})
        if len(ranked) == 5:
            break

    # Fetch all finalist evidence and recipe content in one round trip instead of
    # issuing two queries per recipe.
    details = {}
    if ranked:
        ph = ",".join(["%s"] * len(ranked))
        for rid, ingredients, directions, signals, evidence in q(f"""
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
    result = {"query": text, "concepts": concepts, "excludes": excludes,
              "params": {"cuisines": cuisines or [], "spice": spice, "rich": rich},
              "axes": [{"axis": a, "target": t} for a, t in sorted(axes.items())],
              # Samples support the decision trace without returning the whole catalog.
              # The scalar counts are exact and drive the UI.
              "excluded": excluded_sample, "excluded_count": excluded_count,
              "components": component_sample, "component_count": component_count,
              "candidate_count": candidate_count,
              "top": ranked}
    try:   # provenance is a side note; a broken notebook must never break a search
        result["decision_id"] = RECORDER.record(recommendation_record(result, rejected, considered, needles))
    except Exception as e:
        print(f"decision not recorded: {e}", file=sys.stderr)
    try:   # demand side: this real search becomes one ANALYTICS.SEARCH_EVENTS row (source=live_demo)
        record_search_event(text, concepts, axes, excludes, candidate_count)
    except Exception as e:
        print(f"search event not recorded: {e}", file=sys.stderr)
    return result


def record_search_event(text, concepts, axes, excludes, candidate_count):
    """Same schema the synthetic generator writes (sql/15), labeled live_demo. No
    scenario, no authored intent: nobody authored a real person's craving."""
    q("""INSERT INTO ANALYTICS.SEARCH_EVENTS
         SELECT UUID_STRING(), CURRENT_TIMESTAMP(), %s, NULL, NULL,
                PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s)::array, %s,
                'live_demo', NULL, NULL""",
      (text, json.dumps(concepts), json.dumps(axes), json.dumps(excludes),
       candidate_count))


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
        # HTTP Range support: without it Chrome reports seekable=[0,0] on the mp4s and
        # every video.currentTime seek snaps to 0 (the idle loop needs seeks)
        rng = self.headers.get("Range")
        start, end = 0, len(body) - 1
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(0, len(body) - int(b))
            end = int(b) if (a and b) else end
            end = min(end, len(body) - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
        else:
            self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")   # hashed assets change on every build
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.wfile.write(body[start:end + 1])

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
    port = int(os.environ.get("PORT", 8642))       # hosts inject $PORT
    host = os.environ.get("HOST", "127.0.0.1")     # deploy sets HOST=0.0.0.0
    q("SELECT 1")  # warm the warehouse before the first real query
    print(f"CravingRAG live on http://{host}:{port}")
    ThreadingHTTPServer((host, port), H).serve_forever()
