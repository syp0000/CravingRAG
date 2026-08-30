"""CravingRAG demo server — free-text craving → live Snowflake pipeline → JSON.

One stdlib HTTP server (no framework), the pipeline lives in ui/pipeline.py and the
connection in ui/db.py:
  GET /            → ui/app/dist (the React build; `npm run build` in ui/app)
  GET /media/…     → public/media videos and posters, same dist
  GET /catalog     → all recipes (id, title) for the star field
  GET /diagrams/…  → archify diagrams from docs/diagrams (About page embed)
  GET /why?id=…    → the decision record + its causal chain, as a page
  GET /gaps        → ANALYTICS.DEMAND_SUPPLY_GAPS (sql/16) for the Catalog page
  GET /search?q=…  → runs the REAL pipeline for an arbitrary craving (paid Cortex calls)

Security boundary: the deployed server sits behind Cloudflare Access, which is the
authentication layer (allowlisted emails). Access does NOT rate-limit: every request
that passes it reaches Snowflake. This process only bounds request *size* (query
length, parameter counts, statement timeout); per-user throttling is not implemented
for the demo. If the audience ever exceeds a trusted allowlist, add a Cloudflare rate
rule in front or a token bucket here before the search call.

Usage:  .venv/bin/python ui/server.py   → http://localhost:8642
"""
import html
import json
import os
import re
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))
import db                                                    # noqa: E402
from pipeline import RECORDER, RICH_COND, SPICE_COND, search  # noqa: E402

q = db.q

# Request-size limits. The frontend sends 8 cuisines / 6 avoid chips at most; the
# ceilings leave room for the presets without letting a client stuff the embedding
# text or the LIKE-needle list.
MAX_QUERY_LEN = int(os.environ.get("MAX_QUERY_LEN", "300"))
MAX_LIST_ITEMS, MAX_ITEM_LEN = 10, 40
TOKEN_RE = re.compile(r"^[\w\s&'-]+$")


HTML = "text/html; charset=utf-8"
NOT_FOUND = {"error": "not found"}
ASSET_TYPES = {"js": "text/javascript", "css": "text/css", "mp4": "video/mp4", "png": "image/png",
               "svg": "image/svg+xml"}
DIST = ROOT / "app" / "dist"
DIAGRAMS = ROOT.parent / "docs" / "diagrams"


def _safe_child(base, rel):
    """Resolve rel under base; None if it escapes base or is not a file (path traversal)."""
    f = (base / rel).resolve()
    return f if f.is_relative_to(base.resolve()) and f.is_file() else None


class BadRequest(ValueError):
    pass


def _csv_param(qs, name):
    items = [x.strip() for x in (qs.get(name) or [""])[0].split(",") if x.strip()]
    if len(items) > MAX_LIST_ITEMS:
        raise BadRequest(f"too many {name} values")
    for x in items:
        if len(x) > MAX_ITEM_LEN or not TOKEN_RE.match(x):
            raise BadRequest(f"invalid {name} value")
    return items


def parse_search_params(query_string):
    """Query string → search() arguments. Raises BadRequest on anything out of bounds."""
    qs = parse_qs(query_string)
    text = (qs.get("q") or [""])[0].strip()
    if not text:
        raise BadRequest("empty query")
    if len(text) > MAX_QUERY_LEN:
        raise BadRequest(f"query longer than {MAX_QUERY_LEN} characters")
    spice = (qs.get("spice") or [None])[0] or None
    rich = (qs.get("rich") or [None])[0] or None
    if spice is not None and spice not in SPICE_COND:
        raise BadRequest("invalid spice value")
    if rich is not None and rich not in RICH_COND:
        raise BadRequest("invalid rich value")
    return text, _csv_param(qs, "cuisine"), _csv_param(qs, "avoid"), spice, rich


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
    timeout = 30   # socket read/write timeout per request; a stalled client frees its thread

    def log_message(self, *a):  # quiet
        pass

    def send_json(self, obj, code=200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", code)

    def send_bytes(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
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

    # ---- routes: each returns None after writing a response ----
    def route_index(self, u):
        self.send_file(DIST / "index.html", HTML)

    def route_asset(self, u):
        # everything Vite copies into dist: hashed bundles, public/media videos, icons
        f = _safe_child(DIST, u.path.lstrip("/"))
        if f is None:
            return self.send_json(NOT_FOUND, 404)
        self.send_file(f, ASSET_TYPES.get(f.suffix.lstrip("."), "application/octet-stream"))

    def route_diagram(self, u):     # archify HTML from docs/diagrams
        f = _safe_child(DIAGRAMS, u.path[len("/diagrams/"):])
        if f is None or f.suffix != ".html":
            return self.send_json(NOT_FOUND, 404)
        self.send_file(f, HTML)

    def route_why(self, u):
        page = why_page((parse_qs(u.query).get("id") or [""])[0])
        if page is None:
            return self.send_json({"error": "unknown decision id"}, 404)
        self.send_bytes(page.encode(), HTML)

    def route_gaps(self, u):
        self.send_json(gaps())

    def route_catalog(self, u):
        rows = q("SELECT recipe_id, title FROM raw.curated_recipes ORDER BY recipe_id")
        self.send_json([{"recipe_id": int(r), "title": t.strip()} for r, t in rows])

    def route_search(self, u):
        try:
            args = parse_search_params(u.query)
        except BadRequest as e:
            return self.send_json({"error": str(e)}, 400)
        self.send_json(search(*args))

    EXACT = {"/": route_index, "/why": route_why, "/gaps": route_gaps, "/catalog": route_catalog,
             "/search": route_search, "/favicon.svg": route_asset, "/icons.svg": route_asset}
    PREFIX = {"/assets/": route_asset, "/media/": route_asset, "/diagrams/": route_diagram}

    def do_GET(self):
        u = urlparse(self.path)
        handler = self.EXACT.get(u.path) or next(
            (h for pre, h in self.PREFIX.items() if u.path.startswith(pre)), None)
        try:
            if handler is None:
                return self.send_json(NOT_FOUND, 404)
            handler(self, u)
        except Exception:  # don't die; full trace to stderr, only a fixed message to the client
            traceback.print_exc()  # raw messages can carry SQL, account or key details
            self.send_json({"error": "internal error"}, 500)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8642))       # hosts inject $PORT
    host = os.environ.get("HOST", "127.0.0.1")     # deploy sets HOST=0.0.0.0
    q("SELECT 1")  # warm the warehouse before the first real query
    print(f"CravingRAG live on http://{host}:{port}")
    ThreadingHTTPServer((host, port), H).serve_forever()
