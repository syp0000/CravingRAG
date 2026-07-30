# V2 Plan — rebuild around a sensory knowledge layer

Working agreement: Siyeon writes the code. Weekends only. Each weekend ends with a
deliverable that works on its own, so a skipped weekend never leaves the project broken.

## Scope decisions (settled, with why)

| Decision | Why |
|---|---|
| **English only** | Cross-lingual stays a *v1 finding* (measured 0.09 handicap) — cite it, don't carry it. Target audience is US-based. |
| **Curated corpus, ~300–500 dishes** | American mainstream + Tex-Mex + popular Asian (curry, pho, tteokbokki) + Mediterranean-lite. Small enough to judge honestly — the judge must know the dishes. |
| **Single source: RecipeNLG** (pending spot-check) | Unified schema with ingredients + directions kills the thin-source hallucination problem structurally. Fallback if spot-check fails: filter existing Epicurious + hand-write ~50 gap dishes as CSV. |
| **Same embedding model as v1** (`arctic-embed-l-v2.0`) | Change the architecture OR the model, never both — otherwise the improvement can't be attributed. |
| **Graph = query expansion + explanation, never retrieval itself** | Pure graph traversal reintroduces lexical matching: a query concept missing from the graph would return *nothing* (the "squirts" failure, made total). Embeddings stay as fallback. |
| **Cortex Search attribute filters + numeric boosts, no hand-tuned weighted sum** | The platform already does hybrid + rerank; a custom `0.4×a + 0.25×b` is indefensible ("why 0.4?"). |
| **Exclusion filter = string match + 3–5 hand aliases** | `NOT ILIKE '%almond%'` + marzipan/frangipane/amaretto. No allergen ontology. Labelled a *preference filter, not medical advice*; hidden-allergen misses are a documented limitation. |
| **Keep all v1 tables** (`SEARCH.RECIPE_VECTORS` etc.) | Only way to re-derive the baseline. |
| **Phases 6–8 of the old plan: dropped** | Pantry, receipts, live API — none of it improves retrieval quality. |

## Weekend 1 — Corpus + baseline number

The baseline must be measured on the **new curated corpus** with the **old method**,
before anything is rebuilt. Without it, "v2 improved X → Y" cannot be said.

- [x] ~~Download RecipeNLG, spot-check the gap dishes~~ **PASSED (2026-07-29).** All gap
      dishes present with real ingredients + directions (tteokbokki 19, bulgogi 247,
      birria 20, pad thai 574). Verified rows are genuine (Gungjung Tteokbokki via
      allrecipes). **RecipeNLG is the single source; fallback path retired.**
      - Bonus: the `NER` column carries pre-extracted ingredient names — use it for the
        exclusion/allergen filter instead of parsing quantity strings.
      - ⚠️ License is **non-commercial research/educational only**: fine for this project,
        but never commit the CSV or any extract to the repo (`data/` is gitignored — keep
        it there), and credit RecipeNLG (Poznań University of Technology) in the README.
- [ ] Write `data/curation_list.csv` (`pattern,cuisine`) — the dish list IS the cuisine column, no classifier.
- [ ] Filter locally with pandas; load **only** the curated rows (never all 2.2M).
- [ ] Run the v1 pipeline (terse enrichment → embed) over the curated corpus.
- [ ] Write 15 English eval queries (sensory / occasion / constraint-incl-exclusion); judge top-K pool **0–3 graded** per `eval/JUDGING.md`; compute NDCG@5 + Recall@5.

**Deliverable: the baseline number.**

## Weekend 2 — Sensory layer + structured profiles

- [ ] Sensory concept docs, 15–30 only (scoped to the eval queries, not "all food language"). Each: concept, related phrasings, attributes it implies, conflicting attributes. **Hand-verified — LLM drafts, human approves each one** (jjinppang-"earthy" lesson).
- [ ] Structured recipe profiles via `AI_COMPLETE` with `response_format` (JSON schema): attributes + `evidence` + `confidence`. Evidence-free attributes get dropped or low confidence — this is the scalable hallucination detector v1 lacked.
- [ ] Query parser: craving → structured intent JSON (desired / excluded attributes).

**Deliverable: the two tables, spot-checked against dishes Siyeon actually knows.**

## Weekend 3 — Retrieval + the comparison number

- [ ] Cortex Search service over profile text, with attribute columns for filtering.
- [ ] Exclusion filtering (allergens/dietary) as hard SQL filters, aliases from the sensory layer.
- [ ] Each stage emits JSON (intent → expanded concepts → candidates → final + paths). **This is the UI's data feed — no frontend-invented edges.**
- [ ] Re-judge the same 15 queries, same rules → NDCG@5 vs baseline, per category.

**Deliverable: "baseline X → v2 Y", with the exclusion category expected to show the
biggest gain (it's the measured v1 negation failure, fixed by construction).**

## Weekend 4 — UI + writeup

- [ ] Graph UI, **static first**: query → lit concepts → candidate paths → final recipes, rendered from the stage JSON. Animation only if time remains (agentic coding is fine here).
- [ ] README results section: baseline-vs-v2 table, per-category breakdown, 3–5 failure cases with diagnosis, credits spent.
- [ ] Replace the informal "3/10 → 9/10" in the resume line with the measured numbers.

**Deliverable: demo + writeup. This is the portfolio artifact.**

## Success criteria

- Exclusion queries: v2 must beat baseline (this is the designed-in win — if it doesn't, something is wired wrong).
- Multi-constraint sensory queries ("refreshing + juicy + not too sweet"): improvement expected via expansion; report honestly if absent.
- Every number in the README traceable to a query that can be re-run.

## Known risks

| Risk | Mitigation |
|---|---|
| RecipeNLG lacks the Asian dishes | Fallback path is already defined; decide in the first hour of Weekend 1 |
| Sensory layer bloat | Hard cap 30 concepts; scoped to eval queries |
| UI eats the schedule | Static graph is the Weekend 4 deliverable; animation is stretch |
| Judging drift between baseline and v2 | Same 15 queries, same `JUDGING.md` rules, judged in one sitting each time |
