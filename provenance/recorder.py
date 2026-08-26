"""Decision provenance: CravingRAG hands a note to a notebook and does not care whose
notebook it is.

A record is a plain dict. Required keys: id, kind, summary. Optional: causes (list of
ids this decision followed from) and anything else the caller wants to keep.

Backends, chosen by env CRAVING_DECISIONS:
  jsonl      (default) append-only data/decisions.jsonl, stdlib only
  semantica  semantica.context.ContextGraph, persisted as JSON next to the jsonl
  off        NullRecorder, records vanish

Inspect:  python -m provenance.recorder list [kind]
          python -m provenance.recorder show <id>
          python -m provenance.recorder trace <id>      # follow `causes` back to roots
"""
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "data" / "decisions.jsonl"      # data/ is gitignored


def new_id(prefix):
    return f"{prefix}:{uuid.uuid4().hex[:8]}"


class DecisionRecorder:
    """The interface. Any notebook must be able to do these four things."""

    def record(self, rec):          # -> id
        raise NotImplementedError

    def get(self, rec_id):          # -> dict or None
        raise NotImplementedError

    def list(self, kind=None):      # -> [dict]
        raise NotImplementedError

    def trace(self, rec_id):
        """Walk `causes` back to the roots. Returns records root-first, ending at rec_id."""
        seen, order = set(), []

        def walk(i):
            if i in seen:
                return
            seen.add(i)
            r = self.get(i)
            if r is None:
                return
            for c in r.get("causes") or []:
                walk(c)
            order.append(r)

        walk(rec_id)
        return order


def _stamp(rec):
    rec = dict(rec)
    rec.setdefault("id", new_id(rec.get("kind", "decision")))
    rec.setdefault("ts", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    for k in ("kind", "summary"):
        if not rec.get(k):
            raise ValueError(f"decision record needs '{k}'")
    return rec


class NullRecorder(DecisionRecorder):
    def record(self, rec):
        return _stamp(rec)["id"]

    def get(self, rec_id):
        return None

    def list(self, kind=None):
        return []


class JsonlRecorder(DecisionRecorder):
    """One JSON object per line. Duplicate ids: last line wins."""

    def __init__(self, path=DEFAULT_PATH):
        self.path = Path(path)

    def record(self, rec):
        rec = _stamp(rec)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return rec["id"]

    def _all(self):
        # ponytail: full scan per lookup; fine below ~100k lines, index or sqlite after
        out = {}
        if self.path.exists():
            with open(self.path, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        r = json.loads(line)
                        out[r["id"]] = r
        return out

    def get(self, rec_id):
        return self._all().get(rec_id)

    def list(self, kind=None):
        return [r for r in self._all().values() if kind is None or r.get("kind") == kind]


class SemanticaRecorder(DecisionRecorder):
    """Same notebook interface, Semantica ContextGraph underneath.

    Maps our record onto record_decision(category, scenario, reasoning, outcome,
    confidence, metadata) and `causes` onto add_causal_relationship(cause, effect,
    'CAUSED'). The full record travels in metadata so nothing is lost in the mapping.
    Semantica assigns its own uuid per decision and caps each metadata value at 1000
    chars, so the record JSON travels as rec_0000.. chunks in the node's properties and
    lookups by our id scan for it.

    Measured on semantica 0.6.6: import ~40s; ContextGraph is in-memory, persisted by
    save_to_file/load_from_file; after a reload trace_decision_chain() raises "not
    found" (the decision index is not rebuilt from nodes), which is why trace() here is
    the base-class walk over our own `causes`, not Semantica's.
    """

    def __init__(self, path=DEFAULT_PATH.with_suffix(".semantica.json")):
        from semantica.context import ContextGraph   # lazy: heavy import, optional dep
        self.path = Path(path)
        self.graph = ContextGraph(advanced_analytics=False, node_embeddings=False,
                                  extract_entities=False, extract_relationships=False)
        if self.path.exists():
            self.graph.load_from_file(self.path)

    CHUNK = 1000   # Semantica caps every metadata value at 1000 chars (len(str(value)))

    def _nodes(self):
        for n in self.graph.nodes.values():
            props = getattr(n, "properties", None) or {}
            parts = [props[k] for k in sorted(props) if k.startswith("rec_")]
            if parts:
                yield n.node_id, json.loads("".join(parts))

    def record(self, rec):
        rec = _stamp(rec)
        conf = rec.get("confidence")
        blob = json.dumps(rec, ensure_ascii=False)
        sid = self.graph.record_decision(
            category=rec["kind"],
            scenario=rec.get("scenario") or rec["summary"],
            reasoning=rec.get("reasoning") or rec["summary"],
            outcome=str(rec.get("outcome") or rec["summary"])[:1000],
            confidence=float(conf) if conf is not None else 0.0,
            metadata={f"rec_{i:04d}": blob[j:j + self.CHUNK]
                      for i, j in enumerate(range(0, len(blob), self.CHUNK))},
        )
        by_id = {r["id"]: nid for nid, r in self._nodes()}
        for c in rec.get("causes") or []:
            if c in by_id:
                self.graph.add_causal_relationship(by_id[c], sid, "CAUSED")
        # ponytail: whole-graph rewrite per record; swap for a graph store if it grows
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.graph.save_to_file(self.path)
        return rec["id"]

    def get(self, rec_id):
        return next((r for _, r in self._nodes() if r["id"] == rec_id), None)

    def list(self, kind=None):
        return [r for _, r in self._nodes() if kind is None or r.get("kind") == kind]


def get_recorder(name=None):
    name = (name or os.environ.get("CRAVING_DECISIONS") or "jsonl").lower()
    if name == "off":
        return NullRecorder()
    if name == "semantica":
        return SemanticaRecorder()
    if name == "jsonl":
        return JsonlRecorder()
    raise ValueError(f"CRAVING_DECISIONS must be off|jsonl|semantica, got {name!r}")


if __name__ == "__main__":
    cmd, arg = (sys.argv + [None, None])[1:3]
    rec = get_recorder()
    if cmd == "list":
        for r in rec.list(arg):
            print(f"{r['id']:<28} {r.get('ts','')}  {r['summary']}")
    elif cmd == "show" and arg:
        print(json.dumps(rec.get(arg), indent=2, ensure_ascii=False))
    elif cmd == "trace" and arg:
        for i, r in enumerate(rec.trace(arg)):
            print(f"{'  ' * i}{'└ ' if i else ''}{r['id']}  [{r['kind']}]  {r['summary']}")
    else:
        print(__doc__)
