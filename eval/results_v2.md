# Results — four arms, one judged pool (2026-08-18)

15 frozen queries · 342-recipe corpus · 386 human judgments over the pooled union of every
arm's top-10, blinded (judge saw query + title + profile, never the arm). Metrics from
`sql/12_pooled_eval.sql`: NDCG@5 and Precision@5 against ONE ideal ranking per query built
from all judged pairs; pooled Recall@5 divides by min(5, relevant-in-pool) and is
supplementary, not corpus recall.

## Arms

| arm | what it is |
|---|---|
| `A_raw_vector` | raw title+ingredients+directions → arctic-embed → cosine (control) |
| `V1_baseline` | LLM sensory+context profile → same embedding → cosine |
| `V1_excluded` | V1 ranking + hard exclusion (`V2.EXCLUDED_PAIRS`) + component filter |
| `V2_structured` | 8-axis signals + wiki-mapped intent + exclusion + coverage scoring |

## Overall

| arm | NDCG@5 | P@5 | pooled R@5 |
|---|---|---|---|
| A_raw_vector | 0.582 | 0.560 | 0.560 |
| V2_structured | 0.698 | 0.747 | 0.747 |
| V1_baseline | 0.732 | 0.773 | 0.773 |
| **V1_excluded** | **0.844** | **0.880** | **0.880** |

## Per category (NDCG@5)

| category | A_raw | V1 | V1+excl | V2 |
|---|---|---|---|---|
| sensory | 0.516 | 0.798 | 0.775 | 0.648 |
| occasion | 0.785 | 0.910 | 0.910 | 0.828 |
| exclusion | 0.280 | 0.245 | **0.855** | 0.710 |
| constraint | 0.878 | 0.903 | 0.903 | 0.316 |

## What each gap measures

- **Enrichment works: A → V1 = +0.150.** The project's original claim, measured for the
  first time (the review was right that it never had a control). Raw text ranks by word
  overlap — five almond desserts for "without almonds" (q13 = 0.000), Tzatziki for
  "refreshing juicy dish".
- **Hard exclusion works: V1 → V1+excl = +0.112 overall, exclusion 0.245 → 0.855.**
  q13 0.17→1.00, q14 0.21→1.00. Embeddings cannot subtract; an anti-join can. This is
  the single biggest lever in the project.
- **Structured scoring loses the ranking war: V2 = 0.698.** It wins exactly where
  structure is the point — q03 rich+comforting 1.00, q05 "nothing heavy" 0.62 (best),
  q13 1.00 — and collapses when the query's key noun has no axis: q06 "savory NOODLE
  soup" 0.07 (broths without noodles), q15 "rich CHOCOLATE dessert" 0.32 (rich+sweet
  finds cheesecake), q02 "juicy" 0.36. The 8 axes express intensity, not identity.

**Conclusion: precision from structure, coverage from embeddings — now with numbers.**
The best retrieval stack is enriched vectors + hard exclusion + component filter; the
axis signals earn their place as the exclusion's evidence and the explanation layer
(constellation UI), not as the ranker.

## Findings recorded during judging

1. **Human judgments violated exclusions too.** 7 pairs graded >0 despite the recipe
   containing the excluded ingredient (Tom Yum for "no shellfish"...). The judge misses
   what a substring cannot: overridden to 0 with provenance
   (`source='..._exclusion_override'`). The machine check audits the human here.
2. **"nuts" ⊄ "almond": category-upward ambiguity.** Baklava lists only "finely chopped
   nuts" — substring exclusion passes it for q13. Judged 0 by the fail-closed principle
   (cannot confirm absence). An alias table maps category→member (shellfish→shrimp);
   nothing maps member→ambiguous-parent. Recorded, not patched.
3. **V1's profile hallucinates identity.** Biscotti (anise, no almonds) is described by
   the V1 enricher as "Italian almond cookies" — the dish-name prior overriding the
   ingredients, v1's plausible-but-wrong failure preserved in the control arm's own
   text. Exclusion works from ingredients, so it was not fooled.
4. **The parser's "heavy" leak has a measured cost.** q05 excludes 3 heavy-cream recipes
   (frozen parser leaks "heavy" as an ingredient term); V1+excl drops to 0.232 vs V1's
   0.372 on q05 — the one query where exclusion hurts.
5. **Judge consistency ceiling: weighted κ = 0.624** (29 re-judged W1 pairs, 79% exact).
   The rejected llama judge (κ=0.53) was not far below the human's own test-retest —
   the rejection stands on its systematic over-exclusion, not the agreement number.

## Honest limits (v3 table in docs/PLAN.md)

Single annotator; 15 dev-set queries written with answers in mind; V1→V2 is not an
ablation (V1→V1+excl and A→V1 are); no independent holdout. The numbers above compare
systems on this pool — they are not general-retrieval claims.
