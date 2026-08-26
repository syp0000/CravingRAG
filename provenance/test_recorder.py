"""Run from repo root:  ./.venv/bin/pytest provenance/ -v"""
import pytest

from provenance.architecture import CHAIN, record_chain
from provenance.recommendation import recommendation_record
from provenance.recorder import JsonlRecorder, NullRecorder, get_recorder

RESULT = {"query": "spicy and savory, nothing creamy", "concepts": ["spicy", "savory"],
          "excludes": ["creamy"], "params": {"cuisines": [], "spice": None, "rich": None},
          "axes": [{"axis": "spicy", "target": 0.8}], "excluded": [], "components": [],
          "top": [{"recipe_id": 7, "title": "Kimchi Jjigae", "sim": 0.71, "edges": []}]}
REJECTED = [{"recipe_id": 3, "title": "Tikka Masala", "sim": 0.74, "why": "excluded:cream"}]


def test_jsonl_round_trip_and_trace(tmp_path):
    rec = JsonlRecorder(tmp_path / "d.jsonl")
    assert record_chain(rec) == [d["id"] for d in CHAIN]
    assert record_chain(rec) == []                      # idempotent
    rid = rec.record(recommendation_record(RESULT, REJECTED, 12, ["creamy", "cream"]))
    got = rec.get(rid)
    assert got["rejected"][0]["why"] == "excluded:cream" and got["confidence"] == 0.71
    assert [r["kind"] for r in rec.list("recommendation")] == ["recommendation"]
    ids = [r["id"] for r in rec.trace(rid)]
    assert ids[0] == "arch:eval-v1-exclusion" and ids[-1] == rid   # root first, self last
    assert "arch:hard-exclusion" in ids                             # exclusion query links to it


def test_no_exclusion_does_not_link_to_exclusion_decision():
    r = recommendation_record({**RESULT, "excludes": []}, [], 5, [])
    assert r["causes"] == ["arch:v2-hybrid"]


def test_record_requires_kind_and_summary(tmp_path):
    with pytest.raises(ValueError):
        JsonlRecorder(tmp_path / "d.jsonl").record({"kind": "x"})


def test_flag_selects_backend(monkeypatch):
    monkeypatch.setenv("CRAVING_DECISIONS", "off")
    assert isinstance(get_recorder(), NullRecorder)
    with pytest.raises(ValueError):
        get_recorder("paper")


def test_semantica_backend_same_contract(tmp_path):
    pytest.importorskip("semantica")
    from provenance.recorder import SemanticaRecorder
    rec = SemanticaRecorder(tmp_path / "g.json")
    record_chain(rec)
    big = {**RESULT, "top": [{**RESULT["top"][0], "edges": [{"axis": "spicy", "value": 0.8,
           "target": 1.0, "evidence": ["10 Thai chile peppers, seeded and minced"] * 40}]}]}
    rid = rec.record(recommendation_record(big, REJECTED, 12, ["creamy", "cream"]))   # > 1000 chars
    reloaded = SemanticaRecorder(tmp_path / "g.json")           # survives a restart
    assert reloaded.get(rid)["selected"][0]["title"] == "Kimchi Jjigae"
    assert [r["id"] for r in reloaded.trace(rid)][0] == "arch:eval-v1-exclusion"
