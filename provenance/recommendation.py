"""Runtime decision A: turn one /search result into a decision record.

    Query -> Preferences -> Candidates -> Constraints -> Scoring -> Rejections -> Pick

Pure function of what search() already computed; no Snowflake, so it is testable.
"""


def recommendation_record(result, rejected, n_considered, needles):
    top = result["top"]
    return {
        "kind": "recommendation",
        "summary": f"{result['query']!r} -> " + (", ".join(d["title"] for d in top) or "no results"),
        "query": result["query"],
        "preferences": {"concepts": result["concepts"], "axes": result["axes"],
                        "params": result["params"]},
        "constraints": {"excludes": result["excludes"], "needles": needles},
        "candidates_considered": n_considered,
        "rejected": rejected,                       # [{recipe_id, title, sim, why}]
        "selected": [{k: d.get(k) for k in ("recipe_id", "title", "sim", "edges")} for d in top],
        "outcome": f"{len(top)} recommendations" if top else "no results",
        # honest: cosine similarity of the winner, not a calibrated probability
        "confidence": top[0]["sim"] if top else None,
        "confidence_basis": "top-1 profile-vector cosine similarity, uncalibrated",
        "causes": ["arch:v2-hybrid"] + (["arch:hard-exclusion"] if result["excludes"] else [])
        # quality-layer rejections cite the V3 decision that put those rules there
        + (["arch:lean-v3"] if any(r["why"].startswith(("format_mismatch", "identity_mismatch",
                                                        "duplicate_dish")) for r in rejected) else []),
    }
