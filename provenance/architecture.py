"""Architecture decision B: the chains that produced CravingRAG V2 and Lean V3.

    eval result -> finding -> decision -> new system version   (twice, linked)

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
     "outcome": "V2.EXCLUDED_PAIRS view (sql/10), aliases table, docs/DECISIONS.md section 6",
     "alternatives_rejected": ["penalize excluded ingredients in the score (still leaks)",
                               "closed exclusion vocabulary (fails open on unknown terms)"]},
    {"id": "arch:v2-hybrid", "kind": "system_version",
     "causes": ["arch:hard-exclusion"],
     "summary": "CravingRAG V2: profile-vector ranking + hard exclusion + component filter; axes explain",
     "outcome": "NDCG@5 0.844 / exclusion 0.855 on the 342-recipe dev corpus (vs 0.732 / 0.245)",
     "source": "README.md 'The result', ui/server.py search()"},
    # Lean V3 (numbers and cases from docs/DECISIONS.md section 11; 20k live corpus, not the
    # judged 342 — V2's NDCG stays untouched and unclaimed by this chain).
    {"id": "arch:eval-20k-quality", "kind": "eval_result",
     "causes": ["arch:v2-hybrid"],
     "summary": "V2 at 20k: 'warm spicy soup' returned three hot-and-sour soups in the top five",
     "outcome": "near-duplicate flooding; limeade for 'cold refreshing dessert'; ganache for 'chocolate dessert'",
     "source": "docs/PLAN.md 'Weekend 5+', docs/DECISIONS.md section 11"},
    {"id": "arch:finding-similarity-no-identity", "kind": "finding",
     "causes": ["arch:eval-20k-quality"],
     "summary": "Vector similarity ranks semantic closeness but does not enforce dish identity, physical format, or diversity",
     "reasoning": "A drink can sit near a dessert query, a component near its dish, and five "
                  "variants of one dish are all equally close; closeness alone cannot say no.",
     "source": "docs/DECISIONS.md section 11"},
    {"id": "arch:runtime-quality-layer", "kind": "architecture_decision",
     "causes": ["arch:finding-similarity-no-identity"],
     "summary": "Quality is enforced at serve time by pure-Python rules over the top-200, fail open: only explicit query terms create requirements",
     "reasoning": "Format check, explicit-identity check, query-aware component exemption, "
                  "dish-family dedupe — after hard exclusion, before the top-5 cut. No query "
                  "term, no filtering; fewer than five defensible answers beat padding.",
     "outcome": "ui/search_quality.py; rejections recorded as format_mismatch:* / identity_mismatch:* / duplicate_dish:<kept_id>",
     "alternatives_rejected": ["a new retrieval cycle (re-enrich or re-rank in Snowflake)",
                               "FOOD/DRINK/EITHER UI toggle (the query is the switch)",
                               "separate eval files (the gallery before/after diff is the regression set)"]},
    {"id": "arch:lean-v3", "kind": "system_version",
     "causes": ["arch:runtime-quality-layer"],
     "summary": "CravingRAG Lean V3: V2 retrieval + runtime quality layer; identity, format, components, dedupe",
     "outcome": "post-ship audit on the 20-query live-corpus gallery: 0 drink leaks, 0 duplicate families",
     "source": "docs/DECISIONS.md section 11, ui/search_quality.py (+ ui/test_search_quality.py)"},
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
    for i, r in enumerate(get_recorder().trace("arch:lean-v3")):
        print(f"{'  ' * i}{'└ ' if i else ''}{r['id']}  [{r['kind']}]  {r['summary']}")
