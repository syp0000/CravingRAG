"""Architecture decision B: the chain that produced CravingRAG V2.

    eval result -> finding -> decision -> new system version

Same notebook as the runtime decisions, so a runtime record can point at
`arch:hard-exclusion` in its `causes` and `trace` walks from a served recipe back to
the measurement that made the exclusion filter exist. Idempotent: stable ids, skipped
if already recorded.  Run:  .venv/bin/python -m provenance.architecture
"""
from provenance.recorder import get_recorder

# Numbers from eval/results_v2.md (342-recipe dev corpus, 15 frozen queries; not a
# live-corpus result).
CHAIN = [
    {"id": "arch:eval-v1-exclusion", "kind": "eval_result",
     "summary": "Pure vector retrieval (V1) scored NDCG@5 0.245 on exclusion queries",
     "outcome": "exclusion NDCG@5: raw 0.280, V1 0.245; q13 'without almonds' put Almond Cake at rank 1",
     "source": "eval/results_v2.md, sql/11 done-when check q13"},
    {"id": "arch:finding-embeddings-cannot-subtract", "kind": "finding",
     "causes": ["arch:eval-v1-exclusion"],
     "summary": "Semantic similarity does not model negation: 'without almonds' is near 'almonds'",
     "reasoning": "An embedding measures closeness of meaning; a negated ingredient still "
                  "mentions the ingredient, so the vector moves toward it, not away.",
     "source": "eval/results_v2.md 'What each gap measures'"},
    {"id": "arch:hard-exclusion", "kind": "architecture_decision",
     "causes": ["arch:finding-embeddings-cannot-subtract"],
     "summary": "Exclusion is a hard, fail-closed anti-join applied before ranking, never a score",
     "reasoning": "A dish that violates an exclusion is out regardless of similarity. "
                  "Unverifiable absence (empty NER, ambiguous 'nuts') counts as present.",
     "outcome": "V2.EXCLUDED_PAIRS view (sql/10), aliases table, DECISIONS.md section 6",
     "alternatives_rejected": ["penalize excluded ingredients in the score (still leaks)",
                               "closed exclusion vocabulary (fails open on unknown terms)"]},
    {"id": "arch:v2-hybrid", "kind": "system_version",
     "causes": ["arch:hard-exclusion"],
     "summary": "CravingRAG V2: profile-vector ranking + hard exclusion + component filter; axes explain",
     "outcome": "NDCG@5 0.844 / exclusion 0.855 on the 342-recipe dev corpus (vs 0.732 / 0.245)",
     "source": "README.md 'The result', ui/server.py search()"},
]


def record_chain(rec=None):
    rec = rec or get_recorder()
    written = []
    for d in CHAIN:
        if rec.get(d["id"]) is None:
            rec.record(d)
            written.append(d["id"])
    return written


if __name__ == "__main__":
    w = record_chain()
    print(f"recorded {len(w)} new: {w}" if w else "chain already recorded")
    for i, r in enumerate(get_recorder().trace("arch:v2-hybrid")):
        print(f"{'  ' * i}{'└ ' if i else ''}{r['id']}  [{r['kind']}]  {r['summary']}")
