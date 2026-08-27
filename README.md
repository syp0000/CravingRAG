# CravingRAG

**Describe a craving in plain language. Get real dishes back — with the evidence for why.**

> *"warm spicy soup, no shellfish"* → a sky of 20,000 recipes narrows to five, and every
> match shows the exact ingredient lines that earned it.

## What this is, in plain words

Type what you feel like eating, the way you would say it to a friend: *"something warm and
brothy, but no cream."* CravingRAG searches a catalog of real recipes — nothing is
generated, no dish is invented — and returns up to five that fit. Next to each dish it
shows its receipts: the actual ingredient line that proves the match (*spicy 0.8 ← "10 Thai
chile peppers, seeded and minced"*).

Under the hood it works like this:

1. **Each recipe is read once by an AI** (Snowflake's built-in Cortex models), which writes
   down eight sensory scores — how spicy, warm, rich, fresh, sweet, brothy, savory,
   comforting the dish is, each from 0 to 1 — **plus the ingredient line that justifies
   each score**. No evidence, no score. These land as ordinary columns in a database table.
2. **Your craving is matched by meaning, not by matching words.** Both the recipes and
   your query are turned into *embeddings* — lists of numbers that place similar meanings
   near each other — so "cozy noodle bowl" can find a ramen recipe that never uses the
   word "cozy".
3. **Things you said to avoid are removed by a literal ingredient check, not by the AI.**
   Meaning-based search is bad at "no almonds" (it hears "almonds" and finds almonds), so
   exclusions are enforced by scanning the real ingredient text. If a recipe's ingredients
   can't prove an allergen is absent, it is dropped — the filter fails closed.

The same one-time extraction serves two customers: the consumer search above, and a
business view that reads the identical columns the other way round — *"which cravings does
this catalog fail to serve?"* One extraction, one table, two products.

## Why it exists

It started as a leftover question from a previous project (PantryAI): an LLM can *generate*
a recipe that ticks every requested box and still feel implausible as food. So instead of
asking AI to invent dishes, can we *retrieve* real ones that match what someone feels like
eating? Answering that honestly meant measuring where meaning-based search fails (it
cannot subtract, it drowns identity in vibes) and building controlled fixes. The
measurement below is that study. The Snowflake data-product angle appeared only afterward,
when the columns written for search turned out to already be the analytics
([sql/13](sql/13_catalog_insights.sql) to [sql/16](sql/16_demand_supply_mart.sql)) —
nothing was re-extracted.

Project history and the decision log: [PLAN.md](PLAN.md) · [DECISIONS.md](DECISIONS.md).

## Does it actually work? (measured, not claimed)

Four search strategies ("arms") were compared on the same 15 fixed queries over a
342-recipe curated corpus, with 386 blinded human judgments (the judge saw query and dish,
never which arm produced it). The two metrics both run 0 to 1, higher is better: **P@5**
is simply "of the top five results, what share did the human judge call good"; **NDCG@5**
is the same idea but also rewards putting the best dishes first. Full readout:
[eval/results_v2.md](eval/results_v2.md).

| arm | NDCG@5 | P@5 |
|---|---:|---:|
| raw recipe text → embedding (control) | 0.582 | 0.560 |
| structured 8-axis scoring | 0.698 | 0.747 |
| LLM sensory profile → embedding | 0.732 | 0.773 |
| **profile embedding + hard exclusion** | **0.844** | **0.880** |

Each gap between rows measures one thing:

- **Rewriting recipes into sensory language before embedding works** (+0.150 over the
  control). Raw text ranks by word overlap — it returned five almond desserts for
  *"without almonds"*. This was the project's original claim, finally measured against a
  control.
- **The hard exclusion filter is the biggest lever** (+0.112 overall; on exclusion
  queries alone, NDCG jumps 0.245 → 0.855). Embeddings cannot subtract; a literal
  ingredient check can. Statistical caveat, stated plainly: with only 15 queries the 95%
  confidence interval on this particular gap crosses zero ([-0.009, +0.271] — meaning
  chance can't be fully ruled out; reproduce with `.venv/bin/python eval/confidence.py`).
  The enrichment gap above *is* statistically significant; this one needs more queries.
- **The 8-axis scoring loses the ranking war but wins its real jobs.** It collapses when
  a query's key noun has no axis (*"savory NOODLE soup"* scored 0.07 — the axes express
  intensity, not identity), but it powers the exclusion evidence and the entire
  explanation layer. *Precision from structure, coverage from embeddings* — with numbers.

The judging produced its own findings — including the machine auditing the human (7 human
grades violated their query's exclusion and were overridden to 0, with a record of why),
and a baklava listing `"finely chopped nuts"` judged 0 for *"without almonds"* because
unverifiable absence fails closed. See [eval/results_v2.md](eval/results_v2.md) §Findings.

## Scale

The measured pipeline then ran at scale, meter first: a 1,000-recipe trial batch read
**$4.55** of actual spend from Snowflake's usage ledger, the projection cleared the budget
gate, and **20,000 recipes were enriched in 21 minutes for ~$90** (profiles + embeddings +
signals; the evidence-or-NULL contract held with 0 violations). Scale immediately taught
two things: noodle-soup queries fixed themselves (meaning-based coverage grows with
catalog size), and a new failure appeared (beverages flooding "refreshing" — the curated
342 had no drinks; a random 19.7k does). Procedure and costs: [PLAN.md](PLAN.md)
§Weekend 5+ (the one-off scale-up script itself was not preserved; the plan records the
steps and measured numbers).

**Scope of the numbers:** every metric above was judged on the 342-recipe dev corpus. The
20k live corpus has not been re-judged, and the beverage failure is direct evidence the
scores don't transfer unchanged — treat 0.844 as a dev-corpus result, not a live one.

## The app — a constellation you can ask

```bash
.venv/bin/python ui/server.py    # → http://localhost:8642
```

Every dish is a star. Type a craving: the live pipeline parses it (a real Cortex call),
maps concepts to axes through a hand-editable "sensory wiki", then the exclusion pass
kills matching stars in red — each flashing the ingredient that caught it — and the
survivors (up to five) form a constellation, with the verbatim evidence in a side card.
Ranking uses the measured winner (profile embeddings + exclusion); the axes explain. The
UI renders scored rows and invents nothing.

A runtime quality layer ([ui/search_quality.py](ui/search_quality.py)) then enforces what
the query said explicitly: dish identity (*noodle soup* means noodle **and** soup), food
vs drink (a beverage only appears if the query asked for a drink), component filtering
(ganache is an ingredient, not dinner — unless you asked for ganache), and dish-family
dedupe (one hot-and-sour soup, not three). Fewer than five defensible answers → fewer
than five results, never padding.

The UI is the React app in `ui/app` (served built by `server.py`; `npm run dev` in
`ui/app` for the Vite dev server), two pages: **Search** and **About**. Motion is GSAP,
kept quiet. Earlier skies live in `archive/`.

## Deployment (two tiers)

Every live search is a real Cortex call against a paid warehouse, so a wide-open public
URL would be an open credit meter. The split solves that without hiding the work:

**Public gallery — [demo.cravingrag.com](https://demo.cravingrag.com).** Anyone, no
login, zero cost per view. The same React app builds in gallery mode
(`VITE_PUBLIC_GALLERY=1`, [ui/app/src/api.js](ui/app/src/api.js)) and replays 20 curated
cravings from a bundled `gallery.json` that [ui/build_gallery.py](ui/build_gallery.py)
precomputes once through the real pipeline. Static files only, hosted on Cloudflare
Pages — it never touches Snowflake.

**Live app — cravingrag.com (invite-only).** The arbitrary free-text pipeline. One Docker
image ([Dockerfile](Dockerfile)) builds the React app and serves it with the live API from
one stdlib process; runtime deps are just `snowflake-connector-python`, and credentials
come from `SNOWFLAKE_*` env vars with the key as inline PEM, so no secret file ships
(`server.py` falls back to `.dlt/secrets.toml` only for local dev). The server connects as
**`CRAVING_APP`**, a least-privilege role ([sql/17_app_role.sql](sql/17_app_role.sql)):
read the catalog, call the two AI functions, insert one analytics row per search —
nothing else (`SNOWFLAKE_ROLE` overrides). Hosted on Render (free tier) behind a
Cloudflare-proxied domain with **Cloudflare Access**: only allowlisted emails get in, via
a one-time code (no account needed). The gate is cost control as much as privacy.
Free-tier caveat, stated honestly: the instance sleeps when idle, so the first hit after
a lull takes ~30–60s to wake (the Access email step hides most of that).

## Business side — the same scores as a dashboard

The extraction that powers search doubles as a **semantic layer**
([sql/14_semantic_view.sql](sql/14_semantic_view.sql)) — a described, queryable model of
the axis columns that Snowflake's **Cortex Analyst** can drive, so a product question in
plain English becomes SQL nobody writes:

> *"How many dishes satisfy fresh + spicy?"* → **240 of 19,260 (1.25%)** — while
> warm/savory comfort food is half the catalog. The underserved-combination finding is
> one natural-language question away.

More catalog findings (all real data):
[sql/13_catalog_insights.sql](sql/13_catalog_insights.sql) — the catalog skews hard to
comfort food (warm 70%, spicy 6%), and a dairy-free customer loses **63%** of it.

**Demand → supply → decision.** Supply alone cannot say whether 240 is too few. This
project has no real search traffic, so demand is *declared, not observed* — and labeled
as such: three scenarios with every assumption in one file
([data/demand_scenarios.yml](data/demand_scenarios.yml)), a seeded generator
([pipelines/generate_demo_demand.py](pipelines/generate_demo_demand.py), 3,000 events, 49
phrasings, each parsed once by the real parser) writing to `ANALYTICS.SEARCH_EVENTS`
([sql/15](sql/15_demand_events.sql)) with `source = 'synthetic_demo'` on every row, and a
gap table ([sql/16](sql/16_demand_supply_mart.sql)):

```sql
SELECT * FROM ANALYTICS.DEMAND_SUPPLY_GAPS ORDER BY opportunity_index DESC;
-- phoenix_summer / fresh_spicy: 42.7% of demand vs 1.25% of catalog → 34× under-supplied
```

`opportunity_index = demand_share / supply_share` — "how much people ask for it, divided
by how much of the menu answers it." The **Catalog** page in the UI renders that table.
Real searches from the live app are recorded as `source = 'live_demo'` and kept out of the
synthetic ratios. The generator also records what it *meant* separately from what the
parser *understood*; their disagreement is a free parser-quality measurement (the parser
reads "hot dish" as temperature).

## Decision provenance (why did I get these five?)

Every search writes one decision record: the query, how it was parsed, which candidates
were looked at, which were rejected and for exactly which reason (`excluded:cream`,
`component`, `format_mismatch:drink`, `identity_mismatch:noodle`,
`duplicate_dish:<id>`), the picks with their evidence — and a link to the architecture
decision that put the exclusion filter there in the first place. Architecture decisions
are records too (`provenance/architecture.py`: eval result → finding → decision), so one
trace runs from a served dish all the way back to the measurement that justified it.

The app talks to a small `DecisionRecorder` interface (`provenance/recorder.py`), never
to a vendor. `CRAVING_DECISIONS` picks the backend: `jsonl` (default, stdlib,
`data/decisions.jsonl`), `off`, or `semantica`. Recording failures are logged, never
surfaced: a broken notebook cannot break a search.

```bash
.venv/bin/python -m provenance.architecture          # record the V1→V2 chain once
.venv/bin/python -m provenance.recorder list          # everything recorded
.venv/bin/python -m provenance.recorder trace <id>    # walk causes back to the root
.venv/bin/pytest provenance -v
```

**Why Semantica is an adapter, not the default.** It was evaluated for exactly this layer
(decision records + causal links). Its API fits, but installing it pulls torch,
transformers, spaCy, OpenCV and more (1.8 GB measured), imports in ~40 s, and in 0.6.6
its own chain-tracing does not survive a save/load cycle. The two things this project
needs — append a record, walk the `causes` links — are standard-library work. So
Semantica stays behind the flag for experiments, and retrieval stays entirely in
Snowflake.

## Honest limits (deliberately deferred, tracked in [PLAN.md](PLAN.md) §v3)

Single annotator (test-retest agreement κw 0.624 on 29 re-judged pairs — decent, not
gold-standard); 15 dev-set queries written with answers in mind — an acceptance suite,
not a neutral benchmark; the V1→V2 comparison is not a full ablation (the raw-text
control and exclusion on/off are); eval numbers are 342-corpus measurements, not yet
re-judged at 20k. An LLM judge (a different model family than the enricher) was designed,
validated against the human grades, and **rejected** — not for its agreement score but
for the direction of its errors (systematic over-exclusion). At 20k the corpus floods
with near-duplicates: *"warm spicy soup"* used to return three hot-and-sour soups in the
top five. The quality layer now clusters dish families at serve time, but the demand mart
still counts every variant, so its supply numbers overcount distinct dishes by an
unmeasured factor.

## Architecture

[![CravingRAG system data flow](docs/diagrams/craving-pipeline.png)](docs/diagrams/craving-pipeline.html)

*Interactive version: open [`docs/diagrams/craving-pipeline.html`](docs/diagrams/craving-pipeline.html) locally (archify; source in `craving-pipeline.dataflow.json`).*

## Stack

Python (`dlt`, `pandas`, stdlib HTTP server) · Snowflake (`AI_COMPLETE`, `AI_EMBED`,
`VECTOR`, VARIANT, semantic views, Cortex Analyst) · evaluation: frozen queries, pooled
blinded judgments, NDCG@5 / P@5, bootstrap CIs · deploy: Docker, Render, Cloudflare
Access. No external LLM API, no separate vector DB.

## Data, credits, and licenses

**Data.** The corpus derives from **RecipeNLG** (Poznań University of Technology),
licensed for non-commercial research/educational use. The source CSV and all generated
extracts stay local (`data/*` gitignored except the hand-authored
`data/curation_list.csv` and `data/demand_scenarios.yml`). Search demand in
`ANALYTICS.SEARCH_EVENTS` is synthetic, generated from that yml, and labeled
`source = 'synthetic_demo'` on every row.

**Third-party code and tools this project uses.** All code written here is by Siyeon
Park; the pieces below are other people's work, used under their licenses.

| what | used for | author | license |
|---|---|---|---|
| [GSAP](https://gsap.com) 3.15 + `@gsap/react` | page transitions, constellation and results motion (`ui/app`) | GreenSock / Webflow | [GSAP Standard License](https://gsap.com/standard-license) (no charge) |
| [gsap-skills](https://github.com/greensock/gsap-skills) | agent guidance while writing the GSAP code above | GreenSock | MIT |
| [archify](https://github.com/tt-a1i/archify) 2.16 | the pipeline diagram (`docs/diagrams/craving-pipeline.html`, rendered from `.dataflow.json`) | tt-a1i, based on Cocoon AI's architecture-diagram-generator | MIT |
| [Semantica](https://github.com/semantica-agi/semantica) | optional decision-graph backend behind `CRAVING_DECISIONS=semantica` (see Decision provenance) | semantica-agi | MIT |
| React, Vite | UI build | Meta, Evan You and contributors | MIT |
| `dlt`, `snowflake-connector-python`, `pandas`, PyYAML | loading, Snowflake access, data handling | respective authors | Apache-2.0 / BSD / MIT |
| Snowflake Cortex (`AI_COMPLETE`, `AI_EMBED`, Cortex Analyst) | enrichment, embeddings, semantic layer | Snowflake | Snowflake terms of service |
| [Google Flow](https://labs.google/flow) (Veo) | the three background videos + posters under `ui/app/public/media`, generated for this project | Google | generated output, used under [Google's Gemini/Flow terms](https://policies.google.com/terms/generative-ai) |

Background footage under `ui/app/public/media` (three mp4 + posters) is AI-generated with
Google Flow (Veo) for this project; used under Google's generative-AI terms.

**This repository's own license.** The source code is [MIT](LICENSE). The license covers
the authored code only — the RecipeNLG-derived data stays non-commercial
research/educational regardless, and the generated media and third-party dependencies
above keep their own terms.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .dlt/example.secrets.toml .dlt/secrets.toml   # key-pair auth; see comments inside
```

Pipeline order: `pipelines/curate.py` → `pipelines/load_curated.py` →
`sql/06`–`08` (enrichment) → `pipelines/compile_wiki.py` → `sql/09` (parser) →
`pipelines/load_frozen_parses.py` (⚠️ before 10–12: they read `EVAL2.V2_PARSED`) →
`sql/10`–`12` (exclusion, scoring, pooled eval) → `sql/13`–`14` (insights, semantic
view) → `sql/15` → `pipelines/generate_demo_demand.py` → `sql/16` (demand events,
synthetic demand, demand-supply mart; rerun `sql/14` ④ after) → `sql/17` (app role, for
deploys) → `ui/server.py`. Scaling past the curated 342 is meter-first: read
[PLAN.md](PLAN.md) §Weekend 5+ before spending.

## Checks

```bash
python -m pytest pipelines provenance ui/test_search_quality.py -v
python pipelines/compile_wiki.py --check
python eval/confidence.py        # reproduce the eval table + bootstrap CIs
```

## Repo layout

```text
sql/      01 setup · 06-07 V1 baseline + eval · 08 signals · 09 parser (frozen)
          10 exclusion view · 11 V2 scoring · 12 pooled 4-arm eval
          13 catalog insights · 14 semantic view · 15-16 demand + mart
          17 least-privilege app role
pipelines/ curate · load_curated · compile_wiki · load_frozen_parses · generate_demo_demand
wiki/     craving concepts, axis weights in frontmatter (Obsidian vault)
eval/     queries.yml · JUDGING.md · judgments.csv (386, with provenance)
          parses_frozen.csv · results_baseline.md · results_v2.md
          confidence.py (bootstrap CIs)
ui/       server.py (live pipeline API) · search_quality.py (+ tests) · app/ (React)
provenance/ recorder (interface, jsonl, semantica) · recommendation · architecture · tests
archive/  superseded: DESIGN.md, V1 search, first loaders, earlier UIs
```
