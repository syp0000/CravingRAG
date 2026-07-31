import dlt
import argparse
import os
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
LIST_CSV = REPO / "data" / "curated.csv"

@dlt.resource(
    name="curated_recipes",
    write_disposition="merge",   # same recipe_id overwrites, so reruns never duplicate
    primary_key="recipe_id",
)

def curated_recipes(limit: int | None = None):
    """Read the recipe CSV and yield rows one at a time into dlt."""
    df = pd.read_csv(LIST_CSV)

    if limit is not None:
        df = df.head(limit)

    # recipe_id,title,ingredients,directions,ner,cuisine,pattern
    for idx, row in df.iterrows():
        yield {
            "recipe_id": int(row["recipe_id"]),
            "title": row["title"],
            "ingredients": row["ingredients"],
            "directions": row["directions"],
            "ner": row["ner"],
            "cuisine": row["cuisine"],
            "pattern": row["pattern"],
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                        help="max rows to load (for testing)")
    args = parser.parse_args()

    os.chdir(REPO)   # so .dlt/secrets.toml is always found — see note at top

    pipeline = dlt.pipeline(
        pipeline_name="craving_rag",
        destination="snowflake",
        dataset_name="raw",          # lands in CRAVING_RAG.raw.recipes
    )

    info = pipeline.run(curated_recipes(limit=args.limit))
    print(info)

if __name__ == "__main__":
    main()