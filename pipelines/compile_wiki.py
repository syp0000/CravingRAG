"""
W2.2 — compile the Obsidian wiki into V2.SENSORY_WIKI.

    python pipelines/compile_wiki.py           # parse + load to Snowflake
    python pipelines/compile_wiki.py --check   # parse + validate only, no Snowflake

In:  wiki/*.md      frontmatter `axes:` block is the machine-readable part
Out: V2.SENSORY_WIKI (concept, axis, weight) — one row per (concept, axis)

The prose and [[links]] in the notes are for humans and Obsidian's graph view only.
Retrieval reads nothing but the axis weights. (Links in scoring = the "graph replaces
retrieval" trap.)
"""

import argparse
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WIKI = REPO / "wiki"

AXES = {"spicy", "warm", "brothy", "savory", "rich", "fresh", "sweet", "comforting"}


def parse_note(path: Path) -> list[tuple[str, str, float]]:
    """One note → [(concept, axis, weight), ...]. Empty axes (gap notes) → []."""
    # TODO: read the file, take the text between the first two '---' lines,
    #       and pull the `axis: weight` pairs out of the `axes:` block.
    #
    # The frontmatter is intentionally simple enough to parse by hand:
    #   ---
    #   axes:
    #     fresh: 1.0
    #     warm: 0.0
    #   ---
    # (or `axes: {}` for the gap notes — those return [].)
    #
    # No YAML library needed: split lines, strip, split on ':'.
    # concept = path.stem
    raise NotImplementedError


def validate(rows: list[tuple[str, str, float]]) -> list[str]:
    """Return a list of problems. Empty list = good to load."""
    problems = []
    # TODO, one check per line of the W2.2 done-when:
    #   1. every axis is in AXES (a typo like 'frsh' must fail here, not at query time)
    #   2. every weight is between 0.0 and 1.0
    #   3. 'refreshing' and 'comforting' both resolve (present with >=1 axis)
    raise NotImplementedError


def load(rows: list[tuple[str, str, float]]) -> None:
    """Replace V2.SENSORY_WIKI with the parsed rows."""
    import snowflake.connector

    with open(REPO / ".dlt" / "secrets.toml", "rb") as f:
        c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
    conn = snowflake.connector.connect(
        account=c["host"], user=c["username"],
        private_key_file=c["private_key_path"],
        warehouse=c["warehouse"], database=c["database"], role=c["role"],
    )
    cur = conn.cursor()
    cur.execute("CREATE OR REPLACE TABLE V2.SENSORY_WIKI "
                "(concept STRING, axis STRING, weight FLOAT)")
    cur.executemany("INSERT INTO V2.SENSORY_WIKI VALUES (%s, %s, %s)", rows)
    cur.execute("SELECT COUNT(*) FROM V2.SENSORY_WIKI")
    print(f"loaded {cur.fetchone()[0]} rows")
    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only, skip Snowflake")
    args = ap.parse_args()

    rows = []
    for path in sorted(WIKI.glob("*.md")):
        rows.extend(parse_note(path))

    problems = validate(rows)
    if problems:
        print("FAILED validation:")
        for p in problems:
            print(" -", p)
        sys.exit(1)

    concepts = {r[0] for r in rows}
    print(f"{len(rows)} (concept, axis) rows from {len(concepts)} concepts")
    if not args.check:
        load(rows)


if __name__ == "__main__":
    main()
