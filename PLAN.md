# V2 Plan

**One line:** a Snowflake-native recipe search that turns craving language into dish matches,
then shows *why* each dish matched as a constellation graph.

V1 findings that motivated the rebuild: [DESIGN.md](DESIGN.md) §7.
Judging rules (unchanged between V1 and V2): [eval/JUDGING.md](eval/JUDGING.md).

Working agreement: Siyeon writes the code. Weekends only. Every task states **what must be
true when it's done**, so a session can stop anywhere without losing the thread.

---

## The two systems

Keeping these straight is most of the project.

|  | V1 — baseline | V2 — proposed |
|---|---|---|
| Recipe becomes | one sensory **text** profile | structured **sensory signals** + evidence |
| Query becomes | an embedding | structured intent + exclusions |
| Retrieval | vector similarity only | hard exclusion filter → attribute scoring |
| Exclusions | none (they silently fail) | ingredient match, fail closed |
| Fallback | — | vector search when nothing parses |

**The graph is the visualization layer, not the retrieval engine.** It renders what the
scoring already computed. A retrieval path that depended on the graph would return nothing
for any concept missing from it — v1's "squirts" failure, made total.

---

## Architecture

```
OFFLINE — build the corpus (re-runs only when data or prompts change)

  RecipeNLG 2.23M rows (local CSV, never committed)
        │  W1.1  data/curation_list.csv     114 patterns → cuisine  ✅ done
        ▼
  pandas filter, 1–3 recipes per pattern    2.23M → ~300–400 rows
        │  W1.3  dlt
        ▼
  RAW.CURATED_RECIPES     recipe_id, title, ingredients, directions, ner, cuisine, pattern
        │
        ├─ W1.4  AI_COMPLETE → short sensory text  ─→  V1.RECIPE_PROFILES  (+ AI_EMBED)
        │                                                    ↑ the baseline
        │
        └─ W2.1  AI_COMPLETE + JSON schema         ─→  V2.RECIPE_SIGNALS
                                                        signals VARIANT   (axis → 0..1)
                                                        evidence VARIANT  (axis → ingredients)
                                                        axis is NULL when evidence is empty

  V2.EXCLUSION_ALIASES    canonical → alias        W3.1  peanut → peanuts, peanut butter


ONLINE — answer one craving

  V1:  query ─ AI_EMBED ─→ cosine over V1.RECIPE_PROFILES ─→ top 5

  V2:  "spicy warm soup, no peanuts"
         │  AI_COMPLETE → {"wanted": {"spicy":1.0,"warm":1.0,"brothy":0.8},
         │                 "exclude": ["peanut"]}
         ▼
       hard exclusion on NER (fail closed — unknown counts as excluded)
         ▼
       score surviving recipes: AVG over the wanted axes, skipping NULLs (fail open)
         ▼
       top 5 + the matched (axis, value, evidence) rows   ← these ARE the graph edges
         │
         ├─→ AI_COMPLETE: explanation grounded in evidence
         └─→ UI JSON: center node, dimension nodes, dish nodes
         
       fallback: nothing parsed → V1 vector search. Imperfect beats empty.
```

**Why `signals` is one `VARIANT` column, not one column per axis:** `AI_COMPLETE` already
returns JSON, so it goes in as-is — no parsing, no flattening. Adding an axis later is not a
migration. Query with `signals:spicy::float`.

---

## Scope

### Keep
English only · RecipeNLG curated subset · same embedding model as V1
(`arctic-embed-l-v2.0`) · Snowflake AI functions · ingredient exclusion · attribute scoring ·
constellation UI · **baseline-vs-V2 measurement**

### Dropped, and why

| Dropped | Why |
|---|---|
| Hand-authored craving dictionary (~30 entries + embeddings) | `AI_COMPLETE` parsing handles arbitrary phrasing already. The dictionary solved a problem the parser doesn't have. |
| Dish-variant auto-splitting | Only a problem if recipes are merged by name. Keeping a row = a recipe, capped 1–3 per pattern, dissolves it — gungjung and gochugaru tteokbokki simply stay separate rows with their own signals. |
| `vegetarian` as an exclusion | Needs to know beef broth, gelatin, fish sauce aren't vegetarian. `almond`/`peanut` are string matches; this isn't. Clear line, stay on the easy side. |
| Cortex Search custom boosting | Not needed for scoring over ~400 rows. |
| Multilingual | Cross-lingual stays a cited v1 finding (measured 0.09 handicap), not a feature. |
| Complex reranking weights | `AVG` first. A hand-tuned `0.4×a + 0.25×b` is indefensible in an interview. |

### Constraints that must not be lost
- **RecipeNLG license is non-commercial research/educational.** Never commit the CSV or any
  extract (`data/*` is gitignored; `curation_list.csv` is the hand-authored exception).
  Credit Poznań University of Technology in the README.
- **Same embedding model in V1 and V2.** Change the architecture or the model, never both.
- **Exclusion is labelled a preference filter, not medical advice.** Fail-closed can't catch
  an allergen the ingredient list never names (marzipan, frangipane, amaretto).

---

## Weekend 1 — Baseline

⚠️ **This weekend builds V1 only.** The point is a number to beat. Any V2 work here leaves
nothing to compare against.

⚠️ **Do not improve the V1 prompt.** Reuse `sql/02_enrich.sql`'s terse noun-dense prompt
unchanged. It is the control arm. Ideas for improvement go in a notes file and get used in W2.

| # | Task | Done when |
|---|---|---|
| **W1.1** ✅ | `data/curation_list.csv` — 114 patterns | committed; every pattern matches ≥3 RecipeNLG titles |
| **W1.2** | pandas filter → `data/curated.csv`. `chunksize=100_000`; word boundaries (`pho` matches *phosphate*); cap 1–3 recipes per pattern | 300–400 rows, and `grep -ci` finds tteokbokki, pho, birria, marzipan |
| **W1.3** | dlt → `RAW.CURATED_RECIPES` | `SELECT COUNT(*)` equals the CSV row count |
| **W1.4** | V1 profiles + embeddings → `V1.RECIPE_PROFILES` | row count matches; 5 spot-checked profiles read like `"Tteokbokki. Spicy rice cake dish. Savory, fiery, sweet. Chewy, soft. Gochujang, rice cakes."` |
| **W1.5** | 12–15 English eval queries in `eval/queries.yml` | every category present, **including exclusion** (`"spicy dish without peanuts"`, `"comforting dish without almonds"`) |
| **W1.6** | Build the pool (`sql/05_eval.sql` ③④), judge **graded 0–3** per `JUDGING.md` | `EVAL.JUDGMENTS` loaded, ~50–70% non-zero. Much higher = bar too low to separate systems |
| **W1.7** | NDCG@5 + Recall@5, overall and per category → `eval/results_baseline.md` | numbers exist; **exclusion category recorded separately** — that's the one V2 must move |

Exclusion must be in the baseline *and expected to score badly*. V1 has no exclusion
mechanism at all — "no peanuts" is the negation failure already measured in v1. That failing
number is what makes V2's fix legible.

**→ Deliverable: the baseline number.**

## Weekend 2 — Structured signals

Fix **6–8 axes** up front and don't grow them: `spicy, warm, brothy, savory, rich, fresh,
sweet, comforting`.

| # | Task | Done when |
|---|---|---|
| **W2.1** | `AI_COMPLETE` + `response_format` → `V2.RECIPE_SIGNALS` (`signals`, `evidence` VARIANT) | `SELECT COUNT(*) WHERE signals:spicy IS NOT NULL AND evidence:spicy IS NULL` returns **0** |
| **W2.2** | Query parser prompt → `{"wanted": {...}, "exclude": [...]}` | `"spicy warm soup no peanuts"` parses correctly; so does a phrasing not seen before |
| **W2.3** | Spot-check ~20 recipes against dishes you actually know | kimchi jjigae / pho / birria signals are defensible; anything wrong is an *enrichment* note, not a retrieval one |

## Weekend 3 — V2 retrieval + the comparison

| # | Task | Done when |
|---|---|---|
| **W3.1** | `V2.EXCLUSION_ALIASES` + hard filter on `NER` | `"no peanuts"` removes every peanut dish **and** every dish whose peanut status is unknown |
| **W3.2** | Scoring SQL — AVG over wanted axes, skip NULLs — emitting matched rows as JSON | one query returns ranked dishes **and** their `(axis, value, evidence)` rows |
| **W3.3** | Re-judge the **same queries, same rules**, one sitting | `eval/results_v2.md` beside the baseline; exclusion has moved |

## Weekend 4 — Constellation UI + writeup

| # | Task | Done when |
|---|---|---|
| **W4.1** | UI from W3.2's JSON: center craving node → dimension nodes (colour per axis) → dish nodes (match %). **Static first.** | every edge traces to a backend row; nothing invented in the frontend |
| **W4.2** | Animation — particle flow along edges, glow by match strength, hover shows evidence (`spicy → gochugaru`) | stretch goal; skip if W4.1 ran long |
| **W4.3** | README results: baseline vs V2 table, per-category, 3–5 failure cases with diagnosis, credits spent | the informal "3/10 → 9/10" in the resume line replaced by measured numbers |

---

## Success criteria

- **Exclusion queries must beat baseline.** Designed-in; if it doesn't move, something is miswired.
- Multi-constraint sensory queries improve via structured matching — report honestly if not.
- Every number in the README traceable to a re-runnable query.

## Risks

| Risk | Mitigation |
|---|---|
| Weekend 1 drifts into V2 | W1 is V1-only, prompt frozen. V2 tables start W2. |
| Axis creep | 6–8 fixed, decided W2.1, not revisited. |
| UI eats the schedule | Static graph is the deliverable; animation is W4.2, droppable. |
| Judging drift | Same queries, same `JUDGING.md`, each round judged in one sitting. |

## Open

- Whether `AVG` over wanted axes is enough, or axes the query stated explicitly need weight.
- What to show when exclusion empties the result set — "no safe matches" beats a bad match.
