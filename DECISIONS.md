# V2 Data Model — decisions and why

> ⚠️ **Superseded in part.** §1, §2 and §7's `CRAVINGS` table were dropped after review —
> see [PLAN.md](PLAN.md) "Dropped, and why". The reasoning below is kept because the
> *problems* are real and will resurface; only the solutions changed:
>
> - **§1–2 (sensory-distinct dish rows, variant splitting)** — the hub problem is real, but
>   it only exists when recipes are merged by dish name. Keeping a row = a recipe, capped
>   1–3 per pattern, dissolves it without any variant-detection logic.
> - **§4 (`CRAVINGS` dictionary + embedding fallback)** — `AI_COMPLETE` query parsing already
>   handles arbitrary phrasing, so the dictionary solved a problem the parser doesn't have.
>   The *principle* survives: graph provides precision, embeddings provide coverage.
> - **§5–6 (NULL vs 0, fail open/closed)** — unchanged, and load-bearing.
> - **§7–8 (long format)** — replaced by a single `VARIANT` column, which gets the same
>   migration-free axis growth without the join gymnastics.

Derived by working through the failure cases from v1. Each decision below was reached by
testing a proposal against a concrete query and watching it break, so the reasoning is
recorded alongside the choice — two months from now the *why* is the part that gets lost.

---

## 1. A row is a **sensory-distinct dish**, not a recipe and not a dish name

RecipeNLG holds 19 tteokbokki recipes. Collapsing them to one row per *name* fails, because
gungjung tteokbokki (soy, mild) and the gochugaru version (fiery) and the carbonara version
(creamy) have **opposing** sensory attributes. A single profile covering all three would have
to say "sometimes spicy, sometimes mild".

That is exactly the **hub** pathology measured in v1 — "Nice biscuit" appeared in 6 of 20
query pools because its profile was generic enough to sit near everything. A dish claiming
both spicy and mild matches "make me sweat" *and* "mild and comforting", and is a good answer
to neither.

**Split when sensory attributes conflict. Merge when they overlap.** Fame or name is not the
criterion — a well-known variant that tastes the same as another can merge; an obscure one
that tastes opposite must split.

## 2. Variants are discovered from **ingredients**, not from the curator's knowledge

The split rule above is unusable by hand: v1 already showed the limit (nobody could judge
Sapu Mhicha). But the variants fall out of the data — group the recipes matching a pattern,
compare ingredients, and tteokbokki separates itself by `gochugaru/gochujang` vs `soy sauce`
vs `cream`. RecipeNLG's `NER` column ships normalized ingredient names, so no parsing of
`"1 Tbsp. soy sauce"` is needed.

Data finds the variants; the human only confirms them.

## 3. Store **primitive axes** only; cravings are a mapping on top

Two levels, and they must not be flattened together:

```
primitive   temperature, acidity, weight, texture, spice, fat, ...   ← measurable from ingredients
composite   refreshing, comforting, "cures a hangover", ...          ← a combination of primitives
```

"Refreshing" is not an axis. It is roughly *cold + acidic + light*. Tested by asking where
`"crispy on the outside, tender inside"` lands among the six basic tastes — it does not,
because it is texture. v1's failures clustered in texture and temperature for this reason.

**Why primitives only:** adding a new craving term two months from now costs one row in the
mapping table — no LLM calls, no re-embedding. Storing composites per dish would mean
re-evaluating all 500 dishes every time the craving vocabulary grows. v1's pain was
re-enriching the whole corpus on every prompt change; this structure removes that for
vocabulary growth.

## 4. Unknown craving wording resolves by **embedding the dictionary**

A user types `"squirts liquid when you bite"`. It is not in the craving dictionary, and
pre-populating every phrasing is impossible (`squirts`, `pops`, `bursts`, ...).

So the ~30 dictionary entries are themselves embedded. An unseen phrase finds its nearest
entry (`juicy`) and borrows its primitives. Infinite phrasings collapse onto a small fixed
vocabulary.

If even that is too weak a match, fall back to plain vector search over recipes — v1
behaviour, imperfect but non-zero. That query returned a fish ball at rank 1, which is a
defensible answer; returning nothing would not be.

**This is what "the graph must not replace retrieval" means in practice: the graph provides
precision, embeddings provide coverage.** A pure graph traversal would return zero results
for any concept missing from the graph, turning v1's partial failure into a total one.

## 5. No evidence → **NULL**, never 0

The LLM assigns each axis a value plus the ingredients that justify it. Empty evidence is
normal, not an error — gungjung tteokbokki genuinely has nothing supporting "refreshing".

Storing 0 conflates **"confirmed not refreshing"** with **"not determined"**. A query for
*"rich and heavy, not refreshing"* would then rank unmeasured dishes as perfect matches, and
recipes with sparse ingredient lists would score 0 on every axis — a hub in reverse.

NULL keeps the two apart. This is also the automated version of v1's hallucination check,
which required someone who had eaten jjinppang to notice "earthy" was wrong. Domain knowledge
does not scale; an empty evidence array is checkable in SQL.

## 6. NULL handling **differs by axis type**

| Axis type | NULL means | Behaviour | Cost of being wrong |
|---|---|---|---|
| Sensory (refreshing, weight, texture) | not measured | **fail open** — include, rank low | a mediocre recommendation |
| Exclusion (allergen, dietary) | can't confirm absence | **fail closed** — exclude | an allergic reaction |

Excluding every sensory NULL would let *document* sparsity masquerade as a property of the
*dish* — and v1 showed sparse sources skew non-Western, so that rule would quietly bias the
corpus. Including an unconfirmed allergen is a different category of wrong.

Architecturally this means exclusion axes never enter scoring at all; they are a hard filter
applied first.

> Still labelled **a preference filter, not medical advice**: fail-closed cannot catch an
> allergen that the ingredient list never names (marzipan, frangipane, amaretto). A few hand
> aliases help; an allergen ontology is out of scope.

## 7. Tables

Three stored, two behaviours that stay in code:

```
DISHES            sensory-distinct dish: title, ingredients, directions, cuisine
DISH_PRIMITIVES   (dish_id, axis) → value, evidence, confidence        ← long format
CRAVINGS          craving phrase → primitive combination + embedding

logic (not tables): dictionary-embedding fallback, fail open/closed
```

**`DISH_PRIMITIVES` is long, not wide.** Adding an axis is an INSERT rather than a migration,
and axes will keep being added. Evidence also belongs per-axis — wide format would need
`spicy_evidence`, `salty_evidence`, … doubling columns with every axis. The cost is needing
`PIVOT`/`GROUP BY` to see one dish's full profile, which is the cheaper side of the trade.

Primary key is `(dish_id, axis)` — a repeated `dish_id` is correct here, not a duplicate.

## 8. Scoring: the parsed intent is **also** long, so it is a join

```sql
WITH intent(axis, target) AS (
    VALUES ('spicy', 0.8), ('temperature', 1.0), ('richness', 0.6)
),
matched AS (
    SELECT p.dish_id, p.axis, p.value, p.evidence,
           1 - ABS(p.value - i.target) AS axis_score
    FROM DISH_PRIMITIVES p
    JOIN intent i USING (axis)          -- both sides keyed by axis
    WHERE p.value IS NOT NULL           -- fail open; exclusion axes filtered earlier
)
SELECT dish_id, AVG(axis_score) AS score
FROM matched
GROUP BY dish_id
ORDER BY score DESC;
```

Wide format would require naming every axis by hand in the SELECT.

**Each row of `matched` is a graph edge, for free:**

```
craving "매콤"  →  axis spicy  →  dish jjamppong   (evidence: gochugaru)
craving "뜨끈"  →  axis temp   →  dish jjamppong   (evidence: served hot)
```

The UI's paths do not need separate construction — the scoring trace *is* the explanation.
That is what "every visible connection comes from Snowflake, not frontend decoration" means
concretely.

## 9. What ranks the live top-5: V1 vectors rank, V2 signals filter

This is the one decision that was implemented but never written down in one place. The
pieces were scattered across `ui/server.py`, `provenance/architecture.py`, `README.md`, and
`eval/results_v2.md`, each dropping a different half. The complete statement:

**Live `/search` top-5 = ranked by V1 profile-vector cosine similarity, then V2 signals
applied only as filters (never as the score).** Concretely, in order:

1. **Hard exclusion** (fail-closed, §6): drop rows matching excluded ingredients/aliases.
2. **Component + dial filters**: drop rows the extracted V2 axes rule out (spice/rich dials,
   component match). These use the axes for what §5-6 said they are for: evidence, not rank.
3. **Ranking**: `ORDER BY VECTOR_COSINE_SIMILARITY(V1.RECIPE_PROFILES.profile_vec, query_vec)
   DESC`, walk the candidates, stop at 5.

Implementation: the full pipeline is `ui/server.py` search() — docstring `server.py:11-13`,
exclusion `:87-92`, component `:102-104`, dial filters `:112-125`, ranking `:127-136`, the
literal `== 5` cut `:139-154`. The V2 axis-scoring implementation (`sql/11_v2_scoring.sql`,
`EVAL2.V2_RUNS`) exists only as an eval arm and is never read by the server.

**Why V1 ranks and V2 only filters.** Measured on the 342-recipe dev corpus, NDCG@5:

| arm | NDCG@5 |
|---|---|
| A_raw_vector | 0.582 |
| V2_structured (axis-sum ranker) | 0.698 |
| V1_baseline | 0.732 |
| **V1_excluded (live)** | **0.844** |

The V2 structured ranker scored *below* plain V1. It wins on individual queries where the
craving is an intensity the axes measure (q03 "rich comforting" 1.00, q13 "comforting w/o
almonds" 1.00), but collapses when the query's key noun has no axis (q06 "savory noodle soup"
0.07, q15 "rich chocolate dessert" 0.32). Per §3, the axes express *intensity, not identity*.
So the axes earn their place as the exclusion's evidence and the constellation explanation,
not as the ranker. Full arm/category breakdown: `eval/results_v2.md`.

**Parked: a query-type router (V2 for "abstract/comforting", V1 otherwise).** Tempting from
the q03/q05/q13 wins, but not adopted, for two reasons. (a) At the category level V2 *loses*
the sensory bucket (0.648 vs V1 0.798), because the same sensory category holds both its wins
and its collapses (q06, q02) — the "abstract" label does not separate them. (b) The only
supporting evidence is 3 of 15 queries, quoted as prose; the per-query x per-arm NDCG matrix
is not committed anywhere. Precondition before revisiting: dump that matrix from
`sql/12_pooled_eval.sql` and confirm the V2-winning queries share an *axis-nameable* pattern.
Until then, routing would be built on the exact failure mode (identity vs intensity) that V2
already lost to.

---

## Still open

- How the LLM converts ingredients into a numeric axis value (0–1? ordinal buckets?), and
  whether `AVG` is the right aggregate versus weighting axes the query stated explicitly.
- Whether `DISHES` needs a variant label (`tteokbokki (gochugaru)`) or whether the title
  from the chosen representative recipe suffices.
