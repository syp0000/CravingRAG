"""CravingRAG demo server — free-text craving → live Snowflake pipeline → JSON.

One stdlib HTTP server, two endpoints:
  GET /            → ui/live.html
  GET /catalog     → all recipes (id, title) for the star field
  GET /search?q=…  → runs the REAL pipeline for an arbitrary craving:
                     ① V2.PARSE_CRAVING (live Cortex call)
                     ② exclusion needles = parsed terms + V2.EXCLUSION_ALIASES
                     ③ ranking = the measured winner arm (V1 profile vectors
                        + hard exclusion + component filter; NDCG@5 0.844)
                     ④ axis evidence for the top dishes from V2.RECIPE_SIGNALS
The frozen-parse rule applies to EVAL only; the product parses live.

Usage:  .venv/bin/python ui/server.py   → http://localhost:8642
"""
import json
import tomllib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import snowflake.connector

ROOT = Path(__file__).parent
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
    global CONN
    try:
        cur = CONN.cursor()
    except Exception:
        CONN = connect()
        cur = cur = CONN.cursor()
    cur.execute(sql, params or ())
    return cur.fetchall()


def search(text):
    parsed = json.loads(q("SELECT V2.PARSE_CRAVING(%s)", (text,))[0][0] or "{}")
    concepts = parsed.get("concepts") or []
    excludes = [e.lower() for e in (parsed.get("exclude") or [])]

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

    # winner-arm ranking: profile vector cosine, filters applied (embed evaluated ONCE)
    top = q(f"""
        SELECT v.recipe_id, v.title,
               ROUND(VECTOR_COSINE_SIMILARITY(v.profile_vec, e.qv), 4) AS sim
        FROM V1.RECIPE_PROFILES v
        CROSS JOIN (SELECT AI_EMBED('{EMBED}', %s) AS qv) e
        ORDER BY sim DESC""", (text,))
    ranked, seen = [], set()
    for rid, title, sim in top:
        rid = int(rid)
        # UI-only dedupe by normalized title (Siyeon's call): three "Hot And Sour Soup"
        # stars tell the viewer nothing — eval keeps every row, the sky keeps one per name
        name = " ".join(title.lower().split())
        if rid in excl or comp.get(rid) or name in seen:
            continue
        seen.add(name)
        ranked.append({"recipe_id": rid, "title": title.strip(), "sim": float(sim)})
        if len(ranked) == 5:
            break

    # axis evidence for the finalists
    for d in ranked:
        d["edges"] = []
        if axes:
            for (sig, ev) in q("SELECT signals, evidence FROM V2.RECIPE_SIGNALS WHERE recipe_id=%s", (d["recipe_id"],)):
                sig = json.loads(sig or "{}"); ev = json.loads(ev or "{}")
                for axis, target in sorted(axes.items()):
                    if sig.get(axis) is not None:
                        d["edges"].append({"axis": axis, "value": float(sig[axis]), "target": target,
                                           "evidence": ev.get(axis, [])[:3]})
    return {"query": text, "concepts": concepts, "excludes": excludes,
            "axes": [{"axis": a, "target": t} for a, t in sorted(axes.items())],
            "excluded": [{"recipe_id": r, "matched": m} for r, m in excl.items()],
            "components": [r for r, c in comp.items() if c],
            "top": ranked}


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

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == "/":
                body = (ROOT / "live.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif u.path == "/catalog":
                rows = q("SELECT recipe_id, title FROM raw.curated_recipes ORDER BY recipe_id")
                self.send_json([{"recipe_id": int(r), "title": t.strip()} for r, t in rows])
            elif u.path == "/search":
                text = (parse_qs(u.query).get("q") or [""])[0].strip()
                if not text:
                    return self.send_json({"error": "empty query"}, 400)
                self.send_json(search(text))
            else:
                self.send_json({"error": "not found"}, 404)
        except Exception as e:  # surface errors to the UI during the demo, don't die
            self.send_json({"error": str(e)}, 500)


if __name__ == "__main__":
    q("SELECT 1")  # warm the warehouse before the first real query
    print("CravingRAG live on http://localhost:8642")
    ThreadingHTTPServer(("127.0.0.1", 8642), H).serve_forever()
