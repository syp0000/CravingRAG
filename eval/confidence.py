"""Paired bootstrap CIs for the 4-arm eval (Codex review 2026-08-26: point estimates
over 15 queries carried three-decimal precision and no uncertainty at all).

Reads EVAL2.ALL_RUNS (rankings) + eval/judgments.csv (grades, unjudged = 0, same rule
as sql/12), computes NDCG@5 per query per arm against the shared pooled ideal, then a
paired bootstrap (resample queries with replacement) for every arm-vs-arm delta.

Usage: .venv/bin/python eval/confidence.py
"""
import csv
import math
import random
import tomllib
from collections import defaultdict
from pathlib import Path

import snowflake.connector

ROOT = Path(__file__).parent.parent
K = 5
BOOT = 10000


def connect(schema="EVAL2"):
    with open(ROOT / ".dlt/secrets.toml", "rb") as f:
        c = tomllib.load(f)["destination"]["snowflake"]["credentials"]
    return snowflake.connector.connect(
        account=c["host"], user=c["username"], private_key_file=c["private_key_path"],
        warehouse=c["warehouse"], database=c["database"], role=c["role"], schema=schema)


def ndcg_at_k(grades_in_rank_order, ideal_grades):
    dcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades_in_rank_order[:K]))
    idcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(sorted(ideal_grades, reverse=True)[:K]))
    return dcg / idcg if idcg else 0.0


def main():
    grades = {}
    with open(ROOT / "eval/judgments.csv") as f:
        for row in csv.DictReader(f):
            grades[(row["query_id"], int(row["recipe_id"]))] = int(row["grade"])

    cur = connect().cursor()
    cur.execute("SELECT arm, query_id, recipe_id, rank FROM EVAL2.ALL_RUNS ORDER BY arm, query_id, rank")
    runs = defaultdict(list)
    for arm, qid, rid, _ in cur.fetchall():
        runs[(arm, qid)].append(grades.get((qid, int(rid)), 0))

    ideal = defaultdict(list)
    for (qid, _), g in grades.items():
        ideal[qid].append(g)

    arms = sorted({a for a, _ in runs})
    qids = sorted({q for _, q in runs})
    scores = {a: [ndcg_at_k(runs[(a, q)], ideal[q]) for q in qids] for a in arms}

    print(f"NDCG@{K} over {len(qids)} queries (mean [95% paired bootstrap CI]):\n")
    for a in sorted(arms, key=lambda a: sum(scores[a])):
        print(f"  {a:16s} {sum(scores[a]) / len(qids):.3f}")

    # Bootstrap resampling for CIs: fixed seed for reproducible numbers, no security use.
    rng = random.Random(20260826)  # NOSONAR
    print(f"\nPairwise deltas ({BOOT:,} resamples; CI excluding 0 = significant):")
    for i, a in enumerate(arms):
        for b in arms[i + 1:]:
            deltas = [scores[b][j] - scores[a][j] for j in range(len(qids))]
            boots = sorted(sum(rng.choices(deltas, k=len(deltas))) / len(deltas)
                           for _ in range(BOOT))
            lo, hi = boots[int(BOOT * 0.025)], boots[int(BOOT * 0.975)]
            sig = "SIGNIFICANT" if lo > 0 or hi < 0 else "not significant"
            print(f"  {b} - {a:16s} {sum(deltas) / len(deltas):+.3f}  [{lo:+.3f}, {hi:+.3f}]  {sig}")


if __name__ == "__main__":
    main()
