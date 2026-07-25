"""
Phase 1 — load the recipe dataset into Snowflake with dlt.

Usage:
    python pipelines/load_recipes.py              # full load (7,198 rows)
    python pipelines/load_recipes.py --limit 50   # small sample — start here

Dataset: m3hrdadfi/recipe_nlg_lite (HuggingFace)
    columns: uid, name, description, link, ner, ingredients, steps
    train 6,118 + test 1,080 = 7,198 recipes

What dlt handles so you don't have to write it:
    - schema inference and table creation
    - Python -> Snowflake type mapping
    - merge/upsert on the primary key (no duplicates on rerun)
    - idempotent reruns
"""

import argparse

import dlt
from datasets import load_dataset


@dlt.resource(
    name="recipes",
    write_disposition="merge",   # same uid overwrites, so reruns never duplicate
    primary_key="uid",
)
def recipes(limit: int | None = None):
    """Read recipes from HuggingFace and yield them one at a time into dlt."""
    for split in ("train", "test"):
        ds = load_dataset("m3hrdadfi/recipe_nlg_lite", split=split)

        for i, row in enumerate(ds):
            if limit is not None and i >= limit:
                break

            yield {
                "uid": row["uid"],
                "name": row["name"],
                "description": row["description"],
                "ingredients": row["ingredients"],
                "steps": row["steps"],
                "ner": row["ner"],
                "link": row["link"],
                "split": split,
            }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                        help="max rows per split (for testing)")
    args = parser.parse_args()

    pipeline = dlt.pipeline(
        pipeline_name="craving_rag",
        destination="snowflake",
        dataset_name="RAW",          # lands in CRAVING_RAG.RAW.RECIPES
    )

    info = pipeline.run(recipes(limit=args.limit))
    print(info)

    # TODO (learning): open the resulting table in Snowsight and look at the
    #   _dlt_load_id / _dlt_id metadata columns dlt added. dlt always tracks which
    #   load produced each row — that is data lineage, for free.


if __name__ == "__main__":
    main()
