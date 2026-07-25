"""
Phase 1 — load the recipe dataset into Snowflake with dlt.

Usage:
    python pipelines/load_recipes.py              # full load (~13.5k rows)
    python pipelines/load_recipes.py --limit 50   # small sample — start here

Dataset: Hieu-Pham/kaggle_food_recipes (HuggingFace) — Epicurious recipes, plain CSV.
    columns: Title, Ingredients, Instructions, Image_Name, Cleaned_Ingredients
    13,501 rows (a handful have null Title/Instructions and are skipped)

We read the CSV directly instead of using the `datasets` library, because `datasets` v3+
dropped support for script-based datasets and pulling a plain file needs no extra dependency.

What dlt handles so you don't have to write it:
    - schema inference and table creation
    - Python -> Snowflake type mapping
    - merge/upsert on the primary key (no duplicates on rerun)
    - idempotent reruns
"""

import argparse
import os
from pathlib import Path

import dlt
import pandas as pd

# dlt resolves .dlt/secrets.toml relative to the CURRENT WORKING DIRECTORY, not to this
# file. Running `python pipelines/load_recipes.py` from inside pipelines/ therefore makes
# dlt look in pipelines/.dlt/ and fail with a confusing "missing credentials" error.
# Pinning the cwd to the repo root makes the script work from anywhere.
REPO_ROOT = Path(__file__).resolve().parent.parent

RECIPES_CSV_URL = (
    "https://huggingface.co/datasets/Hieu-Pham/kaggle_food_recipes/resolve/main/"
    "Food%20Ingredients%20and%20Recipe%20Dataset%20with%20Image%20Name%20Mapping.csv"
)

# Second source. The Epicurious corpus above is almost entirely American/European, which
# quietly breaks the cross-lingual queries in eval/queries.yml: a Korean query for
# "warm broth that cures a hangover" scores badly not because retrieval is bad, but
# because the corpus contains no such dish. That is a corpus gap, not a retrieval defect,
# and the two are easy to confuse when reading the numbers.
#
# worldcuisines is Wikipedia-derived and covers ~650 Asian dishes (Korea 69, Japan 182,
# China 177, India 127). It has descriptions rather than ingredients/steps, which is fine:
# Phase 2 rewrites everything into a flavor profile anyway.
WORLD_CSV_URL = (
    "https://huggingface.co/datasets/worldcuisines/food-kb/resolve/main/worldcuisines.csv"
)


@dlt.resource(
    name="recipes",
    write_disposition="merge",   # same recipe_id overwrites, so reruns never duplicate
    primary_key="recipe_id",
)
def recipes(limit: int | None = None):
    """Read the recipe CSV and yield rows one at a time into dlt."""
    df = pd.read_csv(RECIPES_CSV_URL)

    # A few rows have no title or no instructions. They would produce meaningless
    # flavor profiles in Phase 2, so drop them at ingestion rather than downstream.
    df = df.dropna(subset=["Title", "Ingredients", "Instructions"])

    if limit is not None:
        df = df.head(limit)

    # Image_Name looks like a natural key but has ~29 duplicates, so use the row
    # index instead — it is unique by construction and stable for a fixed file.
    for idx, row in df.iterrows():
        yield {
            "recipe_id": int(idx),
            "title": row["Title"],
            "ingredients": row["Ingredients"],
            "instructions": row["Instructions"],
            "image_name": row["Image_Name"],
        }


@dlt.resource(
    name="world_dishes",
    write_disposition="merge",
    primary_key="dish_id",
)
def world_dishes(limit: int | None = None):
    """Read the world-cuisine knowledge base — the international half of the corpus."""
    df = pd.read_csv(WORLD_CSV_URL)
    df = df.dropna(subset=["Name", "Text Description"])

    # Descriptions run from 3 to ~1,090 characters, and a short one cannot support a
    # grounded flavor profile — the LLM has nothing to work from and invents instead.
    # Karakudamono ("various pastry desserts originating from another country") came
    # back confidently described as "rich sweetness, delightfully chewy, slight
    # crispness", none of which is in the source or knowable from it.
    #
    # 80 characters drops 311 of 2,386 dishes (13%). Spot-checking the 80-120 range
    # shows those still list real ingredients, so the cut lands in the right place.
    # This is also cheaper: the rows removed are exactly the ones whose LLM call could
    # only have produced noise.
    df = df[df["Text Description"].str.len() >= 80]

    if limit is not None:
        df = df.head(limit)

    for idx, row in df.iterrows():
        yield {
            "dish_id": f"wc-{idx}",
            "title": row["Name"],
            "description": row["Text Description"],
            "cuisines": row["Cuisines"],
            "countries": row["Countries"],
            "area": row["Area"],
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                        help="max rows to load (for testing)")
    args = parser.parse_args()

    os.chdir(REPO_ROOT)   # so .dlt/secrets.toml is always found — see note at top

    pipeline = dlt.pipeline(
        pipeline_name="craving_rag",
        destination="snowflake",
        dataset_name="raw",          # lands in CRAVING_RAG.raw.recipes
    )

    # Both resources load in one run. dlt creates a separate table per resource and
    # keeps their schemas independent, so the two sources never have to be reshaped
    # to match each other at ingestion time — that happens in 02_enrich.sql instead.
    info = pipeline.run([recipes(limit=args.limit), world_dishes(limit=args.limit)])
    print(info)

    # TODO (learning): open the resulting table in Snowsight and look at the
    #   _dlt_load_id / _dlt_id metadata columns dlt added. dlt always tracks which
    #   load produced each row — that is data lineage, for free.


if __name__ == "__main__":
    main()
