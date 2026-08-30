"""Integration tests for ui/server.py against a scripted fake Snowflake connection.
Run from repo root:  ./.venv/bin/pytest ui/ -v

Covers pipeline.search() end to end, request routing and parameter validation over a
real HTTP socket, the db.q() retry on a dead connection, error sanitization, and
failures of the paid Cortex calls (PARSE_CRAVING, AI_EMBED) — nothing here talks to
Snowflake.
"""
import json
import sys
import threading
import types
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from provenance.recorder import JsonlRecorder

UI = Path(__file__).parent


# ---------- fake snowflake ----------

class FakeDB:
    """Routes SQL by substring (first match wins) to rows, or to a callable that
    returns rows / raises. Records every execute and every connect."""

    def __init__(self):
        self.routes, self.calls, self.connects = [], [], 0

    def on(self, key, rows):
        self.routes.insert(0, (key, rows))
        return self

    def connect(self, **kw):
        self.connects += 1
        return FakeConn(self)

    def sql(self, key):
        return [(s, p) for s, p in self.calls if key in s]


class FakeConn:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return FakeCursor(self.db)


class FakeCursor:
    def __init__(self, db):
        self.db, self.rows = db, []

    def execute(self, sql, params=(), timeout=None):
        self.db.calls.append((sql, list(params)))
        for key, rows in self.db.routes:
            if key in sql:
                self.rows = rows(sql, params) if callable(rows) else rows
                return
        self.rows = []

    def fetchall(self):
        return self.rows


def _import_server():
    """Stub the connector before importing the credential-free server modules."""
    boot = FakeDB()
    fake = types.ModuleType("snowflake.connector")
    fake.connect = boot.connect
    pkg = sys.modules.setdefault("snowflake", types.ModuleType("snowflake"))
    pkg.connector = fake                       # real package may already be imported
    sys.modules["snowflake.connector"] = fake
    sys.path.insert(0, str(UI))
    import server
    return server


server = _import_server()
import db  # noqa: E402
import pipeline  # noqa: E402


def _raise(msg):
    def f(*a):
        raise RuntimeError(msg)
    return f


# stats columns: candidate_count, excluded_count, component_count
STATS = (7, 2, 1)
ROW = lambda rid, title, sim=0.8, comp=False, matched=None, profile="": (  # noqa: E731
    rid, title, sim, comp, matched, profile, *STATS)


@pytest.fixture
def fake(monkeypatch, tmp_path):
    d = FakeDB()
    d.on("PARSE_CRAVING", [(json.dumps({"concepts": ["spicy"], "exclude": ["Cream"]}),)])
    d.on("SENSORY_WIKI", [("spicy", 0.8)])
    d.on("EXCLUSION_ALIASES", [("heavy cream",)])
    d.on("AI_EMBED", [ROW(1, "Kimchi Jjigae "), ROW(2, "Tikka Masala", 0.7, matched="cream"),
                      ROW(3, "Chili Paste", 0.6, comp=True), ROW(4, "Kimchi Jjigae II", 0.5),
                      ROW(5, "Beef Chili", 0.4)])
    d.on("FROM raw.curated_recipes c", [
        (1, '["kimchi"]', '["boil"]', '{"spicy": 0.9}', '{"spicy": ["gochugaru", "x", "y", "z"]}'),
        (5, None, None, None, None)])
    d.on("INSERT INTO ANALYTICS.SEARCH_EVENTS", [])
    monkeypatch.setattr(db, "CONN", FakeConn(d))
    monkeypatch.setattr(db, "connect", d.connect)
    rec = JsonlRecorder(tmp_path / "decisions.jsonl")
    monkeypatch.setattr(pipeline, "RECORDER", rec)
    monkeypatch.setattr(server, "RECORDER", rec)
    return d


# ---------- search() ----------

def test_search_happy_path(fake):
    r = server.search("something spicy", cuisines=["Thai", "Korean"], avoid=["Nuts"], spice="fire")
    assert [d["recipe_id"] for d in r["top"]] == [1, 5]
    assert r["top"][0]["title"] == "Kimchi Jjigae"                    # stripped
    assert r["excludes"] == ["cream", "nuts"]                          # parsed + chip, lowercased
    assert (r["candidate_count"], r["excluded_count"]) == (7, 2)
    assert r["component_count"] == 1
    assert r["components"] == [3]
    assert r["excluded"] == [{"recipe_id": 2, "matched": "cream"}]
    assert r["axes"] == [{"axis": "spicy", "target": 0.8}]
    assert r["params"] == {"cuisines": ["Thai", "Korean"], "spice": "fire", "rich": None}
    assert r["decision_id"].startswith("recommendation:")
    # evidence trimmed to 3, missing detail rows degrade to empty content
    assert r["top"][0]["edges"] == [{"axis": "spicy", "value": 0.9, "target": 0.8,
                                     "evidence": ["gochugaru", "x", "y"]}]
    assert r["top"][1]["ingredients"] == []
    assert r["top"][1]["edges"] == []

    (sql, params), = fake.sql("AI_EMBED")
    assert params[0] == "something spicy . Thai or Korean cuisine"
    assert params[1:] == ["cream", "cream", "nuts", "nuts", "heavy cream", "heavy cream"]
    assert "signals:spicy >= 0.6" in sql
    assert "signals:spicy::float >= 0.6" in sql
    (_, dparams), = fake.sql("FROM raw.curated_recipes c")
    assert dparams == [1, 5]
    (_, eparams), = fake.sql("INSERT INTO ANALYTICS.SEARCH_EVENTS")
    assert eparams[0] == "something spicy"
    assert eparams[-1] == 7
    assert json.loads(eparams[3]) == ["cream", "nuts"]

    rec = server.RECORDER.get(r["decision_id"])
    assert {x["recipe_id"]: x["why"] for x in rec["rejected"]} == {
        2: "excluded:cream", 3: "component", 4: "duplicate_dish:1"}
    assert rec["constraints"]["needles"] == ["cream", "nuts", "heavy cream"]


def test_search_null_parse_skips_wiki_and_needles(fake):
    fake.on("PARSE_CRAVING", [(None,)])
    r = server.search("anything")
    assert r["concepts"] == []
    assert r["excludes"] == []
    assert r["axes"] == []
    assert not fake.sql("SENSORY_WIKI")
    assert not fake.sql("EXCLUSION_ALIASES")
    assert "NULL::STRING AS matched" in fake.sql("AI_EMBED")[0][0]


def test_search_no_candidates_returns_empty_top(fake):
    fake.on("AI_EMBED", [(None, None, None, None, None, None, 0, 0, 0)])   # stats-only row
    r = server.search("unicorn soup")
    assert r["top"] == []
    assert r["candidate_count"] == 0
    assert not fake.sql("FROM raw.curated_recipes c")
    assert server.RECORDER.get(r["decision_id"])["outcome"] == "no results"


def test_search_stops_at_five(fake):
    fake.on("AI_EMBED", [ROW(i, f"Dish {i}", 1 - i / 100) for i in range(1, 20)])
    fake.on("FROM raw.curated_recipes c", [])
    r = server.search("food")
    assert [d["recipe_id"] for d in r["top"]] == [1, 2, 3, 4, 5]


def test_search_survives_side_effect_failures(fake, monkeypatch):
    fake.on("INSERT INTO ANALYTICS.SEARCH_EVENTS", _raise("insert denied"))
    monkeypatch.setattr(server.RECORDER, "record", _raise("notebook broken"))
    r = server.search("something spicy")
    assert [d["recipe_id"] for d in r["top"]] == [1, 5]
    assert "decision_id" not in r


# ---------- paid calls ----------

def test_parse_craving_failure_aborts_before_embedding(fake):
    fake.on("PARSE_CRAVING", _raise("Cortex quota exceeded"))
    with pytest.raises(RuntimeError, match="quota"):
        server.search("something spicy")
    assert len(fake.sql("PARSE_CRAVING")) == 2
    assert fake.connects == 1
    assert not fake.sql("AI_EMBED")
    assert not fake.sql("SEARCH_EVENTS")


def test_embed_failure_records_nothing(fake):
    fake.on("AI_EMBED", _raise("AI_EMBED unavailable"))
    with pytest.raises(RuntimeError, match="AI_EMBED"):
        server.search("something spicy")
    assert not fake.sql("SEARCH_EVENTS")
    assert not fake.sql("FROM raw.curated_recipes c")
    assert server.RECORDER.list() == []


def test_transient_cortex_failure_retries_once(fake):
    calls = iter([_raise("transient"), lambda *a: [('{"concepts": []}',)]])
    fake.on("PARSE_CRAVING", lambda *a: next(calls)(*a))
    assert server.search("x")["concepts"] == []
    assert len(fake.sql("PARSE_CRAVING")) == 2
    assert fake.connects == 1


# ---------- q() retries ----------

def test_q_connects_lazily(fake, monkeypatch):
    monkeypatch.setattr(db, "CONN", None)
    fake.on("SELECT 1", [(1,)])
    assert server.q("SELECT 1") == [(1,)]
    assert fake.connects == 1

def test_q_reconnects_on_dead_execute(fake):
    attempts = iter([_raise("connection closed"), lambda *a: [(1,)]])
    fake.on("SELECT 1", lambda *a: next(attempts)(*a))
    old = db.CONN
    assert server.q("SELECT 1") == [(1,)]
    assert fake.connects == 1
    assert db.CONN is not old


def test_q_reconnects_on_dead_cursor(fake, monkeypatch):
    dead = FakeConn(fake)
    monkeypatch.setattr(dead, "cursor", _raise("cursor on closed connection"))
    monkeypatch.setattr(db, "CONN", dead)
    fake.on("SELECT 1", [(1,)])
    assert server.q("SELECT 1") == [(1,)]
    assert fake.connects == 1


def test_q_gives_up_after_one_retry(fake):
    fake.on("SELECT 1", _raise("still dead"))
    with pytest.raises(RuntimeError, match="still dead"):
        server.q("SELECT 1")
    assert fake.connects == 1
    assert len(fake.sql("SELECT 1")) == 2


def test_q_serializes_handler_threads(fake):
    inside, overlap = [], []

    def slow(*a):
        if inside:
            overlap.append(True)
        inside.append(1)
        threading.Event().wait(0.01)
        inside.pop()
        return [(1,)]

    fake.on("SELECT 1", slow)
    ts = [threading.Thread(target=server.q, args=("SELECT 1",)) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert not overlap
    assert len(fake.sql("SELECT 1")) == 8


# ---------- routing over HTTP ----------

@pytest.fixture(scope="module")
def http():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"

    def get(path, headers=None):
        req = urllib.request.Request(base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers
    yield get
    srv.shutdown()


@pytest.fixture
def dist(monkeypatch, tmp_path):
    d = tmp_path / "app" / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<h1>craving</h1>")
    (d / "assets" / "main.js").write_bytes(b"0123456789")
    monkeypatch.setattr(server, "DIST", d)
    return d


def test_search_route_parses_chips(http, fake, monkeypatch):
    seen = {}
    monkeypatch.setattr(server, "search", lambda *a: seen.update(args=a) or {"ok": 1})
    code, body, _ = http("/search?q=+noodle+soup+&cuisine=thai,korean,&avoid=cream&spice=fire")
    assert code == 200
    assert json.loads(body) == {"ok": 1}
    assert seen["args"] == ("noodle soup", ["thai", "korean"], ["cream"], "fire", None)


def test_search_route_rejects_empty_query(http, fake):
    code, body, _ = http("/search?q=%20")
    assert (code, json.loads(body)) == (400, {"error": "empty query"})
    assert not fake.sql("PARSE_CRAVING")


def test_search_route_end_to_end(http, fake):
    code, body, hdr = http("/search?q=something+spicy")
    assert code == 200
    assert hdr["Content-Type"].startswith("application/json")
    assert [d["recipe_id"] for d in json.loads(body)["top"]] == [1, 5]


def test_catalog_and_gaps_routes(http, fake):
    fake.on("SELECT recipe_id, title FROM raw.curated_recipes", [(1, " A "), (2, "B")])
    assert json.loads(http("/catalog")[1]) == [{"recipe_id": 1, "title": "A"}, {"recipe_id": 2, "title": "B"}]

    from decimal import Decimal
    fake.on("DEMAND_SUPPLY_GAPS", [("s1", "k1", 3, Decimal("0.5"), 2, 0.1, 1.5, 4, 0.0, "syn", "v1", 7)])
    fake.on("SEARCH_EVENTS WHERE source", [(0, None, None)])
    fake.on("INTENT_DEFS", [("k1", '{"spicy": 0.8}', 2, 40)])
    g = json.loads(http("/gaps")[1])
    assert g["gaps"][0]["demand_share"] == 0.5
    assert g["gaps"][0]["scenario_id"] == "s1"
    assert g["live"] == {"searches": 0, "min_candidates": None, "avg_candidates": None}
    assert g["intents"] == [{"intent_key": "k1", "target_axes": {"spicy": 0.8}, "matching_dishes": 2, "catalog_size": 40}]


def test_why_route(http, fake):
    assert http("/why?id=nope")[0] == 404
    rid = server.search("something spicy")["decision_id"]
    code, body, hdr = http(f"/why?id={rid}")
    assert code == 200
    assert hdr["Content-Type"].startswith("text/html")
    assert b"Kimchi Jjigae" in body
    assert b"excluded:cream" in body
    assert b"<script" not in body


def test_static_routes(http, dist):
    assert http("/")[1] == b"<h1>craving</h1>"
    code, body, hdr = http("/assets/main.js")
    assert (code, body, hdr["Content-Type"]) == (200, b"0123456789", "text/javascript")
    code, body, hdr = http("/assets/main.js", {"Range": "bytes=2-4"})
    assert (code, body, hdr["Content-Range"]) == (206, b"234", "bytes 2-4/10")
    assert http("/assets/main.js", {"Range": "bytes=-3"})[1] == b"789"
    assert http("/assets/missing.js")[0] == 404


def test_unknown_and_traversal_paths_404(http, dist):
    for p in ["/nope", "/assets/../../server.py",
              "/diagrams/../../ui/server.py", "/diagrams/x.png", "/media/"]:
        assert http(p)[0] == 404, p


# ---------- error sanitization ----------

def test_500_hides_exception_message(http, fake, capsys):
    fake.on("PARSE_CRAVING", _raise("SQL compilation error at ACCOUNT xyz.snowflakecomputing.com"))
    code, body, _ = http("/search?q=x")
    assert code == 500
    assert json.loads(body) == {"error": "internal error"}
    assert b"snowflakecomputing" not in body
    assert "snowflakecomputing" in capsys.readouterr().err   # operator still sees the trace


def test_500_for_non_db_failures(http, fake, monkeypatch):
    monkeypatch.setattr(server, "gaps", _raise("secret detail"))
    code, body, _ = http("/gaps")
    assert code == 500
    assert b"secret" not in body


def test_search_accepts_injected_query_function(monkeypatch, tmp_path):
    """Unit seam: no connection at all, just a callable."""
    fake = FakeDB()
    fake.on("PARSE_CRAVING", [('{"concepts": []}',)])
    fake.on("AI_EMBED", [ROW(9, "Plain Rice", 0.9)])
    monkeypatch.setattr(pipeline, "RECORDER", JsonlRecorder(tmp_path / "d.jsonl"))
    r = pipeline.search("rice", query=lambda sql, p=None: _run(fake, sql, p))
    assert [d["recipe_id"] for d in r["top"]] == [9]


def _run(fake, sql, params):
    c = FakeCursor(fake); c.execute(sql, params or ()); return c.rows


def test_no_axis_vector_fallback(fake):
    fake.on("PARSE_CRAVING", [(None,)])
    r = server.search("anything")
    assert r["axes"] == []
    assert r["top"][0]["edges"] == []
    assert "AND TRUE) AS candidate_count" in fake.sql("AI_EMBED")[0][0]   # supply filter open


def test_malformed_detail_json_degrades_to_empty(fake):
    fake.on("FROM raw.curated_recipes c", [(1, "not json", "[", "{", "{")])
    d = server.search("something spicy")["top"][0]
    assert (d["ingredients"], d["directions"], d["edges"]) == ([], [], [])


def test_richness_and_spice_filters(fake):
    server.search("x", spice="none", rich="light")
    sql = fake.sql("AI_EMBED")[0][0]
    assert "signals:spicy <= 0.2" in sql
    assert "signals:rich <= 0.35" in sql
    fake.calls.clear()
    server.search("x")
    assert "signals:spicy" not in fake.sql("AI_EMBED")[0][0].split("WHERE TRUE")[1].split("ORDER")[0]


@pytest.mark.parametrize("qs,msg", [
    ("q=" + "a" * 301, "query longer than 300 characters"),
    ("q=x&spice=nuclear", "invalid spice value"),
    ("q=x&rich=creamy", "invalid rich value"),
    ("q=x&cuisine=" + ",".join(["k"] * 11), "too many cuisine values"),
    ("q=x&avoid=" + "a" * 41, "invalid avoid value"),
    ("q=x&avoid=cream%3B--", "invalid avoid value"),
])
def test_search_route_validates_params(http, fake, qs, msg):
    code, body, _ = http("/search?" + qs)
    assert (code, json.loads(body)) == (400, {"error": msg}), qs
    assert not fake.sql("PARSE_CRAVING")


def test_search_route_accepts_frontend_values(http, fake, monkeypatch):
    seen = {}
    monkeypatch.setattr(server, "search", lambda *a: seen.update(args=a) or {})
    assert http("/search?q=x&cuisine=korean,thai&avoid=shellfish,peanut&spice=none&rich=light")[0] == 200
    assert seen["args"] == ("x", ["korean", "thai"], ["shellfish", "peanut"], "none", "light")
    assert http("/search?q=x&spice=&rich=")[0] == 200
    assert seen["args"][3:] == (None, None)
