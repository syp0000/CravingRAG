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
    """Word-boundary regex per pattern — bare `pho` otherwise matches 'phosphate'.

    \b works for multi-word patterns too: it anchors only the two ends, so
    "mac and cheese" matches "Best Mac and Cheese Ever" but not "Mac and Cheeseburger".
    (Verified by test, not assumed — an earlier guard rejected 40+ patterns for nothing.)
    """
    return {p: re.compile(rf"\b{re.escape(p)}s?\b", re.I) for p in patterns}


def pick_matches(chunk: pd.DataFrame, matchers, cuisines, kept: dict, per_pattern: int) -> None:
    """Add rows from `chunk` into `kept`, respecting `per_pattern`. Mutates `kept`.

    A title matching two patterns ("Fried Chicken Pot Pie" hits both `fried chicken`
    and `chicken pot pie`) gets added under both — main() dedups by recipe_id at the end.
    """
    for pattern, regex in matchers.items():
        if len(kept[pattern]) >= per_pattern:
            continue  # already filled this pattern

        # Find rows in the chunk where the title matches the regex
        matches = chunk[chunk['title'].str.contains(regex, na=False)]

        # Limit to the number of rows needed to reach per_pattern
        needed = per_pattern - len(kept[pattern])
        matches_to_add = matches.head(needed)

        # Add the matched rows to kept, tagging with pattern and cuisine
        for _, row in matches_to_add.iterrows():
            row_data = row.to_dict()
            row_data['pattern'] = pattern
            row_data['cuisine'] = cuisines[pattern]
            kept[pattern].append(row_data)


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
        pick_matches(chunk, matchers, cuisines, kept, args.per_pattern)
        if all(len(v) >= args.per_pattern for v in kept.values()):
            break        # every pattern filled — no need to read the rest

    out = pd.concat([pd.DataFrame(v) for v in kept.values() if v], ignore_index=True)

    # RecipeNLG's first column is its row index (read as 'Unnamed: 0') — that is our
    # stable recipe_id. Keep only what W1.3 loads; link/source stay behind.
    out = out.rename(columns={"Unnamed: 0": "recipe_id", "NER": "ner"})
    out = out[["recipe_id", "title", "ingredients", "directions", "ner", "cuisine", "pattern"]]

    # One title can match two patterns; the same recipe must not enter the corpus twice.
    before = len(out)
    out = out.drop_duplicates(subset="recipe_id", keep="first")

    OUT_CSV.parent.mkdir(exist_ok=True)
    out.to_csv(OUT_CSV, index=False)

    empty = [p for p, v in kept.items() if not v]
    print(f"{len(out)} rows → {OUT_CSV}" + (f"  ({before - len(out)} cross-pattern dupes dropped)" if before != len(out) else ""))
    print(f"patterns filled: {sum(1 for v in kept.values() if v)}/{len(kept)}")
    if empty:
        print(f"no matches: {', '.join(empty)}")


if __name__ == "__main__":
    main()
