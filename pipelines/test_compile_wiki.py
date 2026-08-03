"""Tests for compile_wiki. Run from repo root:  ./.venv/bin/pytest pipelines/ -v"""
from pathlib import Path

from compile_wiki import parse_note, validate, WIKI


def note(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "testconcept.md"
    p.write_text(body)
    return p


# ---------- parse_note ----------

def test_regular_note(tmp_path):
    p = note(tmp_path, "---\naxes:\n  fresh: 1.0\n  warm: 0.0\n---\n# t\n\nbody\n")
    assert parse_note(p) == [("testconcept", "fresh", 1.0), ("testconcept", "warm", 0.0)]

def test_gap_note_returns_empty(tmp_path):
    p = note(tmp_path, "---\naxes: {}\n---\n# t\n\nbody\n")
    assert parse_note(p) == []

def test_body_with_colons_is_ignored(tmp_path):
    # 'Related: [[x]]' in the body must not be parsed as an axis
    p = note(tmp_path, "---\naxes:\n  rich: 0.5\n---\n# t\n\nRelated: [[rich]]\n")
    assert parse_note(p) == [("testconcept", "rich", 0.5)]

def test_real_wiki_note():
    rows = parse_note(WIKI / "refreshing.md")
    assert ("refreshing", "fresh", 1.0) in rows
    assert len(rows) == 3

def test_mangled_frontmatter_is_silently_empty(tmp_path):
    # The Obsidian Properties panel once wrote axes: "[object Object]".
    # Current behavior: startswith("axes:") skips it -> note parses as a gap note.
    # This is why validate's presence check exists — it is the safety net that
    # turns this silent loss into a loud failure.
    p = note(tmp_path, '---\naxes: "[object Object]"\n---\n# t\n')
    assert parse_note(p) == []


# ---------- validate ----------

GOOD = [("refreshing", "fresh", 1.0), ("comforting", "warm", 0.8)]

def test_good_rows_pass():
    assert validate(GOOD) == []

def test_unknown_axis_fails():
    assert validate(GOOD + [("x", "frsh", 1.0)]) != []      # typo axis

def test_out_of_range_weight_fails():
    assert validate(GOOD + [("x", "rich", 1.5)]) != []

def test_required_concepts_must_resolve():
    # refreshing missing entirely -> must be reported.
    # This is the check that catches the mangled-frontmatter case above.
    only_comforting = [("comforting", "warm", 0.8)]
    assert validate(only_comforting) != []
