"""Build the public gallery: run the REAL pipeline once for a curated set of cravings and
dump the results as static JSON, so the public site (Cloudflare Pages) serves them with
zero Snowflake cost per view.

    .venv/bin/python ui/build_gallery.py     # -> ui/app/public/{gallery,gaps}.json

This spends real Cortex credits once (~20 searches, a few cents). Re-run it whenever you
want the public gallery to reflect a pipeline change, then commit the JSON so the public
build picks it up. Needs local Snowflake creds (.dlt/secrets.toml), same as ui/server.py.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ui"))
import server  # noqa: E402  — reuses the live search()/gaps(); connects at import

OUT = ROOT / "ui" / "app" / "public"

# label = what the visitor clicks; q + params = exactly what the live pipeline receives.
# Chosen for the story: exclusion, coverage (noodle soup), refreshing, dietary, occasion.
CRAVINGS = [
    {"label": "warm spicy soup, no shellfish", "q": "a warm spicy soup", "params": {"avoid": ["shellfish"]}},
    {"label": "rich comforting dinner",        "q": "something rich and comforting"},
    {"label": "refreshing and juicy",          "q": "a refreshing juicy dish"},
    {"label": "chocolate dessert, no almonds", "q": "a rich chocolate dessert", "params": {"avoid": ["almond"]}},
    {"label": "savory noodle soup",            "q": "a savory noodle soup"},
    {"label": "light, nothing heavy",          "q": "something light, nothing heavy"},
    {"label": "spicy Thai, no peanut",         "q": "a spicy dish", "params": {"cuisines": ["thai"], "avoid": ["peanut"]}},
    {"label": "cozy Korean stew",              "q": "a warm cozy stew", "params": {"cuisines": ["korean"]}},
    {"label": "dairy-free and creamy",         "q": "something creamy", "params": {"avoid": ["dairy"], "rich": "rich"}},
    {"label": "fresh light salad",             "q": "a fresh light salad"},
    {"label": "hearty and filling",            "q": "a hearty filling meal"},
    {"label": "mild Indian curry",             "q": "a mild curry", "params": {"cuisines": ["indian"], "spice": "mild"}},
    {"label": "crispy savory snack",           "q": "a crispy savory snack"},
    {"label": "sweet and indulgent",           "q": "a sweet indulgent treat"},
    {"label": "tender slow-cooked meat",       "q": "tender slow cooked meat"},
    {"label": "warm and brothy",               "q": "a warm brothy bowl"},
    {"label": "fire-hot noodles",              "q": "very spicy noodles", "params": {"spice": "fire"}},
    {"label": "cold refreshing dessert",       "q": "a cold refreshing dessert"},
    {"label": "comfort food, no cilantro",     "q": "comfort food", "params": {"avoid": ["cilantro"]}},
    {"label": "light Japanese dish",           "q": "a light dish", "params": {"cuisines": ["japanese"]}},
]


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    # gaps first, so the snapshot does not count this build's own live_demo search rows.
    (OUT / "gaps.json").write_text(json.dumps(server.gaps(), ensure_ascii=False), encoding="utf-8")

    entries = []
    for c in CRAVINGS:
        p = c.get("params", {})
        res = server.search(c["q"], p.get("cuisines"), p.get("avoid"), p.get("spice"), p.get("rich"))
        res.pop("decision_id", None)   # no backend to trace against in the static build
        entries.append({"label": c["label"], "q": c["q"], "params": p, "result": res})
        print(f"  {c['label']}: {len(res.get('top', []))} results", file=sys.stderr)

    (OUT / "gallery.json").write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {len(entries)} cravings + gaps to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    build()
