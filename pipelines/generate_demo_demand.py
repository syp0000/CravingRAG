"""Generate synthetic search demand into ANALYTICS.SEARCH_EVENTS from data/demand_scenarios.yml.

Every assumption lives in the yml (see its header). This script only rolls the dice
with the yml's seed, parses each unique phrasing ONCE through the real V2.PARSE_CRAVING,
and writes labeled rows (source = 'synthetic_demo'). Reruns with the same yml are
byte-identical and cost zero Cortex calls (parses are cached in ANALYTICS.QUERY_PARSES).

Prereq: sql/15_demand_events.sql has been run.
Usage:  .venv/bin/python pipelines/generate_demo_demand.py [--dry-run]
"""
import json
import random
import sys
import tomllib
import uuid
from datetime import datetime, timedelta

import yaml

CFG = yaml.safe_load(open("data/demand_scenarios.yml"))
AXES = ["spicy", "warm", "brothy", "savory", "rich", "fresh", "sweet", "comforting"]


def pick(rng, weights):
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def phrase(rng, intent):
    opts = CFG["phrasings"][intent]
    return rng.choices(opts, weights=[1 / (i + 1) for i in range(len(opts))])[0]   # A6 Zipf


def build_events():
    rng = random.Random(CFG["seed"])
    end = datetime.fromisoformat(str(CFG["window_end"]))
    span = CFG["days"] * 86400
    base = CFG["scenarios"]["baseline"]["intents"]
    total = CFG["total_events"]
    shares = {s: c["share"] for s, c in CFG["scenarios"].items()}
    assert abs(sum(shares.values()) - 1) < 1e-9, "scenario shares must sum to 1"
    counts = {s: round(total * sh) for s, sh in shares.items()}
    counts["baseline"] += total - sum(counts.values())          # rounding dust
    events = []
    for sid, n in counts.items():
        sc = CFG["scenarios"][sid]
        for _ in range(n):
            excl = None
            if "exclusions" in sc:                                # A5
                excl = pick(rng, sc["exclusions"])
                intent = pick(rng, base)
            else:
                intent = pick(rng, sc["intents"])
                if intent == "other":                             # A4
                    intent = pick(rng, base)
            text = CFG["phrasings"][intent][0] + ", " + CFG["exclusion_phrases"][excl] \
                if excl else phrase(rng, intent)
            ts = end - timedelta(seconds=rng.randrange(span))    # A7
            events.append({"event_id": str(uuid.UUID(int=rng.getrandbits(128))),
                           "occurred_at": ts, "query_text": text, "scenario_id": sid,
                           "authored": {"intent_key": intent, "exclusion_key": excl}})
    return events


def main():
    events = build_events()
    uniques = sorted({e["query_text"] for e in events})
    print(f"{len(events)} events, {len(uniques)} unique phrasings, seed {CFG['seed']}")
    assert len(events) == CFG["total_events"]
    assert 30 <= len(uniques) <= 60, len(uniques)
    if "--dry-run" in sys.argv:
        return

    import snowflake.connector
    with open(".dlt/secrets.toml", "rb") as f:
        c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
    conn = snowflake.connector.connect(
        account=c["host"], user=c["username"], private_key_file=c["private_key_path"],
        warehouse=c["warehouse"], database=c["database"], role=c["role"], schema="ANALYTICS")
    cur = conn.cursor()

    # intent definitions: the mart's supply side reads the same rows
    cur.execute("DELETE FROM ANALYTICS.INTENT_DEFS")
    for k, v in CFG["intents"].items():                       # supply, measured now
        cur.execute("""INSERT INTO ANALYTICS.INTENT_DEFS
                       SELECT %s, PARSE_JSON(%s), ANALYTICS.CANDIDATE_COUNT(PARSE_JSON(%s), ARRAY_CONSTRUCT()),
                              (SELECT COUNT(*) FROM V2.RECIPE_AXES), CURRENT_TIMESTAMP()""",
                    (k, json.dumps(v), json.dumps(v)))

    # parse each unique phrasing once (cache first, Cortex only for misses)
    cur.execute("SELECT query_text, parsed, parsed_axes, exclusions, candidate_count FROM ANALYTICS.QUERY_PARSES")
    cache = {r[0]: r[1:] for r in cur.fetchall()}
    for text in uniques:
        if text in cache:
            continue
        cur.execute("SELECT V2.PARSE_CRAVING(%s)", (text,))
        parsed = cur.fetchone()[0]
        cur.execute("""
            WITH t AS (SELECT w.axis, MAX(w.weight) AS target
                       FROM TABLE(FLATTEN(input => PARSE_JSON(%s):concepts)) c
                       JOIN V2.SENSORY_WIKI w ON w.concept = c.value::string
                       GROUP BY w.axis)
            SELECT COALESCE(OBJECT_AGG(axis, target::variant), OBJECT_CONSTRUCT()),
                   COALESCE(PARSE_JSON(%s):exclude, ARRAY_CONSTRUCT())::array
            FROM t""", (parsed, parsed))
        axes, excl = cur.fetchone()
        cur.execute("SELECT ANALYTICS.CANDIDATE_COUNT(PARSE_JSON(%s), PARSE_JSON(%s)::array)", (axes, excl))
        row = (parsed, axes, excl, cur.fetchone()[0])
        cur.execute("INSERT INTO ANALYTICS.QUERY_PARSES SELECT %s, PARSE_JSON(%s), PARSE_JSON(%s), "
                    "PARSE_JSON(%s)::array, %s, CURRENT_TIMESTAMP()", (text, *row))
        cache[text] = row
        print(f"  parsed: {text!r} -> axes={row[1]} excl={row[2]} candidates={row[3]}")

    # replace this version+seed's rows, insert 3,000 (never touches live_demo)
    cur.execute("DELETE FROM ANALYTICS.SEARCH_EVENTS WHERE source='synthetic_demo' "
                "AND generator_version=%s AND seed=%s", (CFG["version"], CFG["seed"]))
    # multi-row insert only rewrites plain VALUES: stage as strings, then PARSE_JSON once
    cur.execute("CREATE OR REPLACE TEMP TABLE ev_stage (event_id STRING, occurred_at TIMESTAMP_NTZ, "
                "query_text STRING, scenario_id STRING, authored STRING)")
    cur.executemany("INSERT INTO ev_stage VALUES (%s, %s, %s, %s, %s)",
                    [(e["event_id"], e["occurred_at"], e["query_text"], e["scenario_id"],
                      json.dumps(e["authored"])) for e in events])
    cur.execute("""
        INSERT INTO ANALYTICS.SEARCH_EVENTS
        SELECT s.event_id, s.occurred_at, s.query_text, s.scenario_id, PARSE_JSON(s.authored),
               p.parsed:concepts, p.parsed_axes, p.exclusions, p.candidate_count,
               'synthetic_demo', %s, %s
        FROM ev_stage s JOIN ANALYTICS.QUERY_PARSES p USING (query_text)""",
        (CFG["version"], CFG["seed"]))
    cur.execute("SELECT scenario_id, COUNT(*) FROM ANALYTICS.SEARCH_EVENTS "
                "WHERE source='synthetic_demo' GROUP BY 1 ORDER BY 1")
    print(cur.fetchall())
    conn.close()


if __name__ == "__main__":
    main()
