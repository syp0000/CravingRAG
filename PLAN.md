# V2 Plan

Data model and the reasoning behind it: [DECISIONS.md](DECISIONS.md).
V1 findings that motivated the rebuild: [DESIGN.md](DESIGN.md) §7.

Working agreement: Siyeon writes the code. Weekends only. Every task states **what must be
true when it's done**, so a session can end mid-weekend without losing the thread.

---

## Architecture

Two halves. Everything expensive runs offline; a query only reads.

```
OFFLINE — build the corpus (re-runs only when data or prompts change)

  RecipeNLG 2.23M rows (local CSV, never committed)
        │  W1.1  curation_list.csv          hand-written: pattern → cuisine
        ▼
  pandas filter                              2.23M → ~400 rows
        │  W1.3  dlt
        ▼
  RAW.CURATED_RECIPES                        title, ingredients, directions, NER, cuisine
        │  W2.1  split variants by ingredients
        ▼
  DISHES                                     one row per sensory-distinct dish
        │  W2.2  AI_COMPLETE + JSON schema
        ▼
  DISH_PRIMITIVES  (dish_id, axis)           value + evidence + confidence, long format
                                             NULL when evidence is empty

  CRAVINGS   craving → primitives            W2.3  ~30 rows, hand-verified
             + AI_EMBED vector               lets unseen phrasings find a nearest entry


ONLINE — answer one craving (all reads)

  "매콤하고 뜨끈한 국물"
        │  parse: look up CRAVINGS — exact, else nearest by embedding
        ▼
  intent: (axis, target) pairs               ('spicy', 0.8), ('temperature', 1.0)
        │  exclusion axes applied FIRST as a hard filter — fail closed
        ▼
  candidate dishes
        │  JOIN DISH_PRIMITIVES USING (axis), AVG(axis_score)    fail open on NULL
        ▼
  ranked dishes  +  the matched rows         ← these rows ARE the graph edges
        │
        ├─→ AI_COMPLETE: explanation grounded in the evidence fields
        └─→ UI: renders paths from the matched rows, invents nothing

  fallback: nothing in CRAVINGS matched well enough → plain vector search (v1 behaviour).
            Imperfect beats empty.
```

---

## Scope decisions (settled)

| Decision | Why |
|---|---|
| **English only** | Cross-lingual stays a cited *v1 finding* (measured 0.09 handicap), not a feature to carry. Audience is US-based. |
| **~300–500 curated dishes** | Small enough that the judge knows the dishes — v1 judging stalled on Sapu Mhicha. |
| **RecipeNLG as the single source** ✅ | Spot-check passed 2026-07-29: tteokbokki 19, bulgogi 247, birria 20, pad thai 574, all with real ingredients + directions. `NER` column ships normalized ingredient names — use it for the exclusion filter. **License is non-commercial research/educational: never commit the CSV or any extract (`data/` is gitignored), and credit RecipeNLG (Poznań University of Technology) in the README.** |
| **Same embedding model as v1** (`arctic-embed-l-v2.0`) | Change the architecture OR the model, never both, or the improvement can't be attributed. |
| **Graph does expansion + explanation, never retrieval** | Pure traversal returns *nothing* for a concept missing from the graph — the "squirts" failure made total. Embeddings stay as the floor. |
| **Cortex Search filters + boosts, no hand-tuned weights** | The platform already does hybrid + rerank. A custom `0.4×a + 0.25×b` is indefensible in an interview. |
| **Exclusion = string match on `NER` + a few hand aliases** | marzipan / frangipane / amaretto. No allergen ontology. Labelled *a preference filter, not medical advice*. |
| **Keep all v1 tables** | The only way to re-derive a baseline. |
| **Old Phases 6–8 dropped** | Pantry, receipts, live API — none improve retrieval quality. |

---

## Weekend 1 — Baseline

⚠️ **This weekend runs the V1 pipeline, not the new data model.** The point is a number to
beat. Building `DISH_PRIMITIVES` now would leave nothing to compare against.

### W1.1 — `data/curation_list.csv`
Hand-write the dish list. It doubles as the cuisine column, so no classifier is needed.

```csv
pattern,cuisine
tteokbokki,korean
bulgogi,korean
pho,vietnamese
birria,mexican
mac and cheese,american
```

~60–100 patterns across: American mainstream · Tex-Mex · popular East/SE Asian ·
Mediterranean-lite.
**Done when:** the file exists with every category represented. Not "complete" — it will grow.

### W1.2 — Filter script
Local pandas: `RecipeNLG_dataset.csv` → `data/curated.csv`.

- `chunksize=100_000` — do not load 2.2GB at once.
- Match on `title`, case-insensitive.
- **Word boundaries on short patterns** — bare `pho` matches *phosphate*.
- Cap per pattern (1–3 recipes each) or one dish drowns the corpus.

**Done when:** `data/curated.csv` has 300–500 rows and `grep -ci` finds tteokbokki, pho and
birria inside it.

### W1.3 — Load to Snowflake
New dlt resource, same shape as `pipelines/load_recipes.py`. Target `RAW.CURATED_RECIPES`.

**Done when:** `SELECT COUNT(*)` in Snowflake equals the CSV row count.

### W1.4 — Enrich + embed, V1 method
Reuse `sql/02_enrich.sql` (terse noun-dense prompt) and `sql/03_embed.sql` against the new
table. **Change the source table only — do not improve the prompt.** This is the control arm.

**Done when:** the vectors table row count matches, and 5 spot-checked profiles read like
`"Tteokbokki. Spicy rice cake dish. Savory, fiery, sweet. Chewy, soft. Gochujang, rice cakes."`

### W1.5 — 15 English eval queries
Rewrite `eval/queries.yml`: sensory · occasion · constraint · **exclusion** (`"no almonds"`,
`"vegetarian"`). Exclusion is where V2 wins by construction, so the baseline has to measure it
failing.

**Done when:** 15 queries exist, every category represented.

### W1.6 — Judge, graded 0–3
Build the pool (`sql/05_eval.sql` steps ③④), export, judge per [eval/JUDGING.md](eval/JUDGING.md).
Grade 0–3, not binary — NDCG needs it, and it collapses to binary for free.

**Done when:** `EVAL.JUDGMENTS` is loaded and ~50–70% of rows are non-zero. Much higher means
the bar is too low to separate systems.

### W1.7 — Compute the number
NDCG@5 and Recall@5, overall and per category → `eval/results_baseline.md`.

**Done when:** the numbers exist and the per-category **exclusion** score is recorded. That is
the one V2 must move.

**→ Deliverable: the baseline.**

---

## Weekend 2 — Sensory layer + primitives

- **W2.1** Split variants: group `RAW.CURATED_RECIPES` by pattern, compare ingredients, emit
  `DISHES`. *Done when:* tteokbokki appears as separate spicy / soy / cream rows.
- **W2.2** `DISH_PRIMITIVES` via `AI_COMPLETE` + `response_format`. Evidence-free axes → NULL.
  *Done when:* `SELECT COUNT(*) WHERE value IS NOT NULL AND evidence = []` returns **0**.
- **W2.3** `CRAVINGS`: ~30 hand-verified entries + `AI_EMBED` vectors.
  *Done when:* `"squirts liquid"` resolves to the `juicy` entry by nearest neighbour.

## Weekend 3 — Retrieval + comparison

- **W3.1** Exclusion filter on `NER`, fail closed. *Done when:* `"no almonds"` returns zero
  dishes containing almond **and** zero dishes whose almond status is unknown.
- **W3.2** Scoring query (the `JOIN ... USING (axis)` shape in DECISIONS §8), emitting matched
  rows as JSON. *Done when:* one query returns ranked dishes **and** their edges.
- **W3.3** Re-judge the **same 15 queries, same rules**. *Done when:* `eval/results_v2.md`
  sits beside the baseline and exclusion has moved.

## Weekend 4 — UI + writeup

- **W4.1** Graph UI, **static first**, rendered from W3.2's JSON. Animation only if time is left.
- **W4.2** README results: baseline vs V2 table, per-category breakdown, 3–5 failure cases with
  diagnosis, credits spent. Replace the informal "3/10 → 9/10" in the resume line with the
  measured numbers.

---

## Success criteria

- **Exclusion queries must beat baseline.** Designed-in; if it doesn't move, something is miswired.
- Multi-constraint sensory queries improve via craving expansion — report honestly if not.
- Every number in the README traceable to a re-runnable query.

## Risks

| Risk | Mitigation |
|---|---|
| Weekend 1 drifts into building the new model | W1 is explicitly the V1 pipeline; new tables start W2. |
| Sensory layer bloat | Hard cap 30 concepts, scoped to the 15 eval queries. |
| UI eats the schedule | Static graph is the W4 deliverable; animation is stretch. |
| Judging drift between baseline and V2 | Same queries, same `JUDGING.md`, each judged in one sitting. |
