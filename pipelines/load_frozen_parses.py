"""Load eval/parses_frozen.csv into EVAL2.V2_PARSED — the ONLY way that table gets built.

Why this exists: sql/11 originally re-ran V2.PARSE_CRAVING to build V2_PARSED. The LLM
is nondeterministic, so "frozen" was a label, not a fact — a live re-parse of q09 came
back [sweet] where the frozen file says [sweet, fresh]. The scorer must consume the file
that was committed on 2026-08-03, not a fresh roll of the dice.

Usage:  .venv/bin/python pipelines/load_frozen_parses.py
"""
import csv
import json
import tomllib

import snowflake.connector

with open(".dlt/secrets.toml", "rb") as f:
    c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
conn = snowflake.connector.connect(
    account=c["host"], user=c["username"], private_key_file=c["private_key_path"],
    warehouse=c["warehouse"], database=c["database"], role=c["role"],
)
cur = conn.cursor()

rows = list(csv.DictReader(open("eval/parses_frozen.csv")))
assert len(rows) == 15, f"expected 15 frozen parses, got {len(rows)}"

cur.execute("""CREATE OR REPLACE TABLE EVAL2.V2_PARSED
               (query_id STRING, query_text STRING, category STRING, parsed VARIANT)""")
for r in rows:
    parsed = json.dumps({"concepts": json.loads(r["CONCEPTS"]),
                         "exclude":  json.loads(r["EXCLUDE"])})
    cur.execute(
        "INSERT INTO EVAL2.V2_PARSED SELECT %s, %s, %s, PARSE_JSON(%s)",
        (r["QUERY_ID"], r["QUERY_TEXT"], r["CATEGORY"], parsed),
    )

cur.execute("SELECT query_id, parsed:concepts::string, parsed:exclude::string "
            "FROM EVAL2.V2_PARSED ORDER BY query_id")
for q, cc, ex in cur.fetchall():
    print(f"{q}  concepts={cc}  exclude={ex}")
print("loaded 15 frozen parses into EVAL2.V2_PARSED")
conn.close()
