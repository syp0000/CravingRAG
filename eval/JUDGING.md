# Relevance judging criteria

Written **before** judging, and not changed during it. Consistency matters more than
getting any single call right — an inconsistent judge makes arms incomparable, which
defeats the point of the whole evaluation.

## The question

> If I searched this, does this dish **deserve** to be in the top 5?

Not "would I be annoyed to see it" (too lenient — everything scores 1 and no arm can be
distinguished from another) and not "is this the single best answer" (too strict).

Binary: `1` = deserves a top-5 slot, `0` = does not.

## Judge from the profile, not from knowledge of the dish

The indexed profile is everything the system knows. Judge against that text.

| Query | Profile | Call |
|---|---|---|
| warm food for a rainy day | Naengmyeon — *"Cold noodle soup… icy broth. Served cold"* | **0** |
| vegetarian, no meat | Hamburger — *"Beef, cheese, bun"* | **0** |
| warm broth | Alicot — *"Stew… Served hot"* | **1** |

This needs no knowledge of Alicot, and that is the point. Judging on real-world knowledge
would make familiar cuisines stricter than unfamiliar ones, biasing the result toward
whatever the judge happens to know.

**If a profile looks wrong for a dish you do know** (jjinppang described as "earthy"),
that is a *different* defect. Note it separately as an enrichment-quality issue — do not
mark it down as a retrieval miss. The two are fixed in different places.

## Rules

1. **Negated constraints are binding.** "no meat at all" returning a hamburger is `0`.
   The query said no meat.

2. **Constraints the query did not state are not applied.** "Something refreshing" does
   not exclude drinks, so a margarita or agua fresca is `1`. If the user wanted food only
   they would have said so. Do not invent restrictions on the user's behalf.

3. **Stated attributes are binding, even when the dish is topically right.** Corpse
   Reviver is a genuine hangover cure, but the query asked for a *warm broth* and it is a
   chilled cocktail: `0`. Topic match does not excuse an attribute miss.

4. **Components count only if the query asks for one.** Leftover-Roast-Chicken-Stock is
   `1` for "warm broth" — it literally is one. Chocolate Glaze is `0` for "chocolate
   dessert" — it is a topping, not a dessert. Ask whether it is the thing requested or an
   ingredient of it.

5. **Near-categories count if the stated attributes hold.** A stew for a "broth" query is
   `1` when it is hot and liquid. Category boundaries are fuzzy; stated attributes are not.

## Sanity check while judging

If more than ~80% of the pool is coming out as `1`, the bar is too low — every arm will
score near 1.0 and the comparison will show nothing. A healthy pool lands around 50-70%
relevant. If it drifts high, tighten rule 1 and 3 and redo the queries judged so far.

## Known limitation

Pooled judgment only ever judges what some arm retrieved. A dish that is genuinely
relevant but that no arm surfaced is never seen, so these numbers are recall **relative to
the pool**, not to the corpus. This is standard for pooled IR evaluation and it means the
absolute numbers are optimistic; the *comparison between arms* is what holds.
