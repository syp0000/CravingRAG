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


class WikiParseError(ValueError):
    """Raised when a wiki note's machine-readable frontmatter is malformed."""


def frontmatter_lines(path: Path) -> list[str]:
    """Return frontmatter lines without the opening/closing delimiters."""
    lines = path.read_text().splitlines()
    if not lines or lines[0].strip() != "---":
        raise WikiParseError(f"{path.name}: missing opening frontmatter delimiter")

    for idx, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return lines[1:idx]

    raise WikiParseError(f"{path.name}: missing closing frontmatter delimiter")


def parse_note(path: Path) -> list[tuple[str, str, float]]:
    """One note → [(concept, axis, weight), ...]. Empty axes (gap notes) → []."""
    concept = path.stem
    rows = []
    in_axes = False

    for raw_line in frontmatter_lines(path):
        stripped = raw_line.strip()
        if not stripped:
            continue

        if stripped == "axes:":
            in_axes = True
            continue

        if stripped == "axes: {}":
            in_axes = False
            continue

        if stripped.startswith("axes:"):
            raise WikiParseError(f"{path.name}: axes must be a block or {{}}")

        if not in_axes:
            continue

        if not raw_line.startswith("  "):
            in_axes = False
            continue

        if ":" not in stripped:
            raise WikiParseError(f"{path.name}: malformed axis row {stripped!r}")

        axis, raw_weight = stripped.split(":", 1)
        try:
            weight = float(raw_weight.strip())
        except ValueError as exc:
            raise WikiParseError(
                f"{path.name}: invalid weight for axis '{axis.strip()}'"
            ) from exc

        axis = axis.strip()
        rows.append((concept, axis, weight))
    return rows


def validate(rows: list[tuple[str, str, float]]) -> list[str]:
    """Return a list of problems. Empty list = good to load."""
    problems = []
    #  every axis is in AXES (a typo like 'frsh' must fail here, not at query time)
    #  every weight is between 0.0 and 1.0
    #  'refreshing' and 'comforting' both resolve (present with >=1 axis)
    for required in ["refreshing", "comforting"]:
        if not any(r[0] == required for r in rows):
            problems.append(f"required concept '{required}' is missing")
    for concept, axis, weight in rows:
        if axis not in AXES:
            problems.append(f"unknown axis '{axis}' for concept '{concept}'")
        if not (0.0 <= weight <= 1.0):
            problems.append(f"weight {weight} out of range for concept '{concept}', axis '{axis}'")
    return problems


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
    parse_errors = []
    for path in sorted(WIKI.glob("*.md")):
        try:
            rows.extend(parse_note(path))
        except WikiParseError as exc:
            parse_errors.append(str(exc))

    problems = parse_errors + validate(rows)
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
