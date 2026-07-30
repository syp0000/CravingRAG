"""
W1.2 — filter RecipeNLG down to the curated corpus.

    python pipelines/curate.py --source ~/Downloads/archive/RecipeNLG_dataset.csv

In:  data/curation_list.csv   (pattern, cuisine)
Out: data/curated.csv         (~300-400 rows, gitignored)

Done when: 300-400 rows, and grep finds tteokbokki, pho, birria, marzipan.
"""

import argparse
import re
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parent.parent
LIST_CSV = REPO / "data" / "curation_list.csv"
OUT_CSV = REPO / "data" / "curated.csv"

PER_PATTERN = 3      # cap per pattern, or one dish drowns the corpus
CHUNK = 100_000      # never load 2.2GB at once


def build_matchers(patterns: list[str]) -> dict[str, re.Pattern]:
    """Word-boundary regex per pattern — bare `pho` otherwise matches 'phosphate'."""
    # TODO: multi-word patterns ("mac and cheese") — does \b still behave?
    return {p: re.compile(rf"\b{re.escape(p)}\b", re.I) for p in patterns}


def pick_matches(chunk: pd.DataFrame, matchers, cuisines, kept: dict) -> None:
    """Add rows from `chunk` into `kept`, respecting PER_PATTERN. Mutates `kept`."""
    # TODO: for each pattern still under quota, find rows whose `title` matches
    #       and append them, tagged with `pattern` and `cuisine`.
    #
    # Worth deciding: a title can match two patterns ("chicken pot pie" vs "pot roast"
    # won't, but "green curry" and "curry" would if both were listed). First match wins,
    # or the more specific one?
    raise NotImplementedError


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="path to RecipeNLG_dataset.csv")
    ap.add_argument("--per-pattern", type=int, default=PER_PATTERN)
    args = ap.parse_args()

    wanted = pd.read_csv(LIST_CSV)
    matchers = build_matchers(wanted["pattern"].tolist())
    cuisines = dict(zip(wanted["pattern"], wanted["cuisine"]))

    kept: dict[str, list] = {p: [] for p in matchers}

    for chunk in pd.read_csv(args.source, chunksize=CHUNK):
        pick_matches(chunk, matchers, cuisines, kept)
        if all(len(v) >= args.per_pattern for v in kept.values()):
            break        # every pattern filled — no need to read the rest

    out = pd.concat([pd.DataFrame(v) for v in kept.values() if v], ignore_index=True)
    # TODO: keep only the columns W1.3 loads —
    #       recipe_id, title, ingredients, directions, ner, cuisine, pattern
    #       (RecipeNLG's own columns are: '', title, ingredients, directions, link, source, NER)
    OUT_CSV.parent.mkdir(exist_ok=True)
    out.to_csv(OUT_CSV, index=False)

    empty = [p for p, v in kept.items() if not v]
    print(f"{len(out)} rows → {OUT_CSV}")
    print(f"patterns filled: {sum(1 for v in kept.values() if v)}/{len(kept)}")
    if empty:
        print(f"no matches: {', '.join(empty)}")


if __name__ == "__main__":
    main()
