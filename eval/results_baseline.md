# V1 baseline results — Weekend 1 (2026-07-31)

System under test: **V1** — terse sensory text profile per recipe, `AI_EMBED`
(`arctic-embed-l-v2.0`), pure cosine top-K. Corpus: the curated 342 recipes
(`RAW.CURATED_RECIPES`). Queries: the 15 frozen in [queries.yml](queries.yml). Judged by
Siyeon, single sitting, grades 0–3 per [JUDGING.md](JUDGING.md); raw grades in
[judgments_baseline.csv](judgments_baseline.csv), reloadable into `EVAL2.JUDGMENTS`.

## Headline

| Arm | NDCG@5 | Recall@5 |
|---|---|---|
| V1 baseline | **0.797** | **0.843** |

| Category | NDCG@5 | Recall@5 |
|---|---|---|
| **exclusion** | **0.504** | **0.567** |
| sensory | 0.832 | 0.892 |
| constraint | 0.903 | 1.000 |
| occasion | 0.910 | 0.920 |

## Reading

**V1 is genuinely good at plain sensory/occasion search on this corpus.** Five queries score
a perfect 1.0. The curated corpus was built so that every query has answers, and the terse
profiles retrieve them. The baseline is not a strawman.

**Exclusion is the failure, exactly as designed.** The two worst queries in the whole set:

- **q13 "comforting dessert without almonds" — NDCG 0.307.** Nine of eleven pool entries were
  almond desserts, with Almond Cake at rank 1. The embedding matches the *word* "almonds", so
  asking for no almonds actively summons them. This is the v1 negation failure, now with a
  number attached.
- **q12 "spicy dish without peanuts" — NDCG 0.352.** Kung Pao Chicken (peanuts, prominently)
  at rank 1.

**The q14 nuance is worth keeping: "warm soup with no shellfish" scored 0.854 — an exclusion
query V1 mostly got right, by luck.** Shellfish soups are a minority of the "warm soup"
neighbourhood, so most retrieved soups happened to be safe. Exclusion failure severity depends
on how strongly the excluded term attracts: "almond" dominates the dessert space it is banned
from; "shellfish" does not dominate soup space. V2's fix should close q12/q13 *and* remove the
luck from q14 (Tom Yum still appeared at ranks 3 and 5).

**q05 "light and clean, nothing heavy" — NDCG 0.474 — is a hidden negation.** The pool
included biscuits-and-gravy, baklava, marzipan and a churro dessert: "nothing heavy" pulled in
*heavy*, the same mechanism as q12/q13 in softer form. Worth watching whether V2's wiki
mapping (`light → rich: low`) fixes it without an explicit exclusion.

**q04 "crispy on the outside, tender inside" — 0.855, better than v1's version of this query.**
Falafel and samosa (profiles literally saying "crispy outside, soft inside") ranked; coleslaw
and hummus still leaked in. The idiomatic-phrase weakness persists but a curated corpus with
genuinely crispy-outside dishes softens it.

## Judge calibration note

Grade distribution: 106×3, 5×2, 9×1, 30×0 — 74% relevant (≥2), just above the 50–70% healthy
band, and heavily bimodal (mostly "perfect or wrong"). Two things follow: recall is near
ceiling for non-exclusion categories (headroom for V2 lives almost entirely in exclusion +
q05/q11), and the same judge with the same tendencies judges V2, so the *comparison* stands
even if absolute numbers read generous.

## The target

V2 (structured signals + sensory wiki + fail-closed exclusion) must move **exclusion 0.504**.
Sensory/occasion should hold — if they drop materially, structured scoring lost something the
embedding had, and that is a finding too.
