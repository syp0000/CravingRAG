# CravingRAG — Design

> "I want something refreshing and bursting with juice" → real recipes + why they match

---

## 1. The problem

Recipe search today is **keyword matching on ingredients or dish names**:
`WHERE ingredient IN ('chicken', 'rice')`.

But that is not how people describe what they actually want to eat.

| What people actually say | Keyword search | What's needed |
|---|---|---|
| "refreshing, bursting with juice" | ❌ no match | semantic (vector) search |
| "warm broth that cures a hangover" | ❌ | semantic search |
| "something cozy for a rainy day" | ❌ | semantic search |

**The reason this project exists: sensory and emotional queries can only be solved with vector
search.** That makes it an ideal problem for learning RAG — you feel *why* embeddings are
necessary instead of taking it on faith.

---

## 2. The core design idea (⭐ most important)

**Naive approach (fails):** embed the raw recipe text (ingredients + steps).
Embedding `"2 cups flour, 1 tsp salt, bake at 350F"` will never land near
`"refreshing and bursting with juice"` in vector space. **Retrieval simply doesn't work.**

**Our approach — document enrichment:**
Use an LLM to generate a **sensory flavor profile** for each recipe first, then embed *that*.

```
Raw recipe
  title: "Citrus Summer Salad"
  ingredients: orange, grapefruit, mint, arugula, olive oil
  steps: ...
        │
        │  ① CORTEX.COMPLETE — "describe taste, texture, and occasion in 2 sentences"
        ▼
Flavor profile  (this is what we actually index)
  "Bright citrus bursts with juice against crisp, peppery greens.
   Perfect for a hot summer lunch or as a palate cleanser after rich food."
        │
        │  ② AI_EMBED (multilingual model)
        ▼
  VECTOR(FLOAT, 1024)
```

Now embedding `"refreshing and bursting with juice"` lands **close** to that vector.

> 💡 This is what RAG practitioners call **rewriting documents into a retrievable form**.
> Using an LLM at *indexing* time — not just at answer time — is the technical heart of this
> project, and the thing worth explaining in an interview.

### Write for the embedding, not for a reader

The single largest quality jump in this project came from changing the *format* of the
generated profiles, not their accuracy.

The first version asked for a vivid two-sentence description. It produced good prose:

> "This dish is a harmonious blend of sweet and tangy flavors, with a subtle hint of
> saltiness. The texture is velvety and smooth..."

Accurate, readable, and nearly useless. Every profile came out on the same skeleton —
*"This dish is a [X] blend of [Y] and [Z], with a subtle hint of [W]"* — so embedded, all
documents looked alike. The shared scaffolding is most of the token count and carries no
information, and it dominated the vector while the part that actually distinguishes a
fruit slush from a fried pastry got diluted.

The symptom was visible in the scores: the top 10 results for *"something refreshing and
bursting with juice"* spanned only 0.516 to 0.416, and included a fried beaver tail, a
taco, and hot water crust pastry.

Rewriting the prompt to emit terse, noun-dense text fixed it:

> "Sorbet. Frozen fruit dessert. Sweet, tangy, refreshing. Smooth, icy, light.
> Fruit juice, fruit purée, honey."

Same model, same corpus, same embedding model. 9 of the top 10 became genuinely
refreshing dishes.

**Two counterintuitive lessons worth stating explicitly:**

1. **Fluency is worthless here and actively harmful.** Nobody reads an indexed document.
   Grammatical scaffolding costs tokens and adds no retrievable signal.
2. **The top similarity score went *down*, from 0.516 to 0.494, while results got much
   better.** Absolute cosine values do not mean what intuition suggests — only ranking is
   trustworthy. Any design that thresholds on an absolute score is built on sand.

This is also why the boilerplate detector in `02_enrich.sql` matters more than it first
appears. It looked like a style check. It was measuring the thing that was breaking
retrieval.

### The risk this creates: hallucination at index time

Enrichment has a failure mode that plain RAG does not, and it is worth stating up front.

**Index-time hallucination is worse than answer-time hallucination**, because it is invisible.
A wrong *answer* can be caught by showing the user its sources. A wrong *flavor profile*
becomes a vector, silently corrupts retrieval for every future query, and no one ever sees the
sentence that caused it.

It is also **systematically biased**. The quality of a profile depends on how much source
detail the model was given:

| Source | Input to the LLM | Result |
|---|---|---|
| Epicurious | full ingredients + instructions | grounded |
| worldcuisines | a ~180-character description | model fills gaps from memory |

And a model's memory is thinner for non-Western dishes — precisely the ones the cross-lingual
queries target. Observed early: jjinppang (a Korean steamed bun) was described as having
"earthy sweetness", which no one who has eaten one would say.

Two mitigations, both in `sql/02_enrich.sql`:
1. A **grounding clause** in the prompt: make every flavor claim traceable to the provided
   text, and stay general instead of inventing when the text is thin.
2. A **spot-check query** that shows source text and generated profile side by side, sorted by
   least source detail first. Domain knowledge is the only real detector — check the cuisines
   you know best.

The honest tension: grounding makes thin-source profiles blander, and blander profiles retrieve
worse. That tradeoff should be **measured per source** in Phase 5, not assumed away. The real
fix is giving the international dishes more source detail (see the REST API source idea in
Phase 8) rather than prompting harder.

---

## 3. End-to-end data flow

```
 [HuggingFace] kaggle_food_recipes (13,501 recipes)
        │
        │  dlt  — incremental load, schema inference, merge by recipe_id
        ▼
 RAW.RECIPES                      ← untouched source data
        │
        │  SQL + CORTEX.COMPLETE   — generate flavor profiles (batch)
        ▼
 ENRICHED.RECIPE_PROFILES         ← sensory description text
        │
        │  SQL + AI_EMBED          — multilingual embeddings
        ▼
 SEARCH.RECIPE_VECTORS            ← VECTOR(FLOAT, 1024)
        │
        │  ┌──────────────────────────────────────────┐
        │  │  user query: "refreshing and juicy"       │
        │  │        ↓ AI_EMBED (same model)            │
        │  │  query vector                             │
        │  │        ↓ VECTOR_COSINE_SIMILARITY         │
        │  └──────────────────────────────────────────┘
        ▼
 Top-K recipes (K=10)
        │
        │  CORTEX.COMPLETE — rerank + explain why each matches
        ▼
 Streamlit UI — 3 recommendations with reasoning
```

---

## 4. Why everything runs inside Snowflake

| Stage | Typical stack | This project |
|---|---|---|
| Ingestion | Airbyte / custom scripts | **dlt** → Snowflake |
| Embeddings | OpenAI API (paid, needs key) | **Snowflake AI_EMBED** |
| Vector store | Pinecone / Weaviate (separate infra) | **VECTOR type** (same table) |
| Generation | OpenAI API | **CORTEX.COMPLETE** |

→ **Zero external API keys, zero separate vector database.** No data leaves the account,
and the whole RAG pipeline runs on free-trial credits.

---

## 5. Model selection (a decision that matters)

Recipes are in **English**. Queries may be in **English or Korean**. Supporting both requires a
**multilingual** embedding model — using an English-only model silently breaks Korean queries,
which is a common and hard-to-debug mistake.

| Purpose | Model | Dimensions |
|---|---|---|
| Embedding | `snowflake-arctic-embed-l-v2.0` | 1024, **multilingual** ✅ |
| (alternative) | `voyage-multilingual-2` | 1024, multilingual |
| ❌ avoid here | `snowflake-arctic-embed-m-v1.5` | 768, English-only |
| Generation | `mistral-large2` or `claude-3-5-sonnet` | — |

> **Why cross-lingual retrieval works:** a multilingual model maps many languages into *one
> shared vector space*, so "상큼한" and "refreshing" land near each other. This lets a Korean
> query retrieve English recipes with no translation step — a genuinely nice property to
> demonstrate, and another good interview talking point.

---

## 6. Build plan

### Phase 1 — Pipeline (no RAG yet)
- [ ] Create Snowflake trial account + database/schema/warehouse (`sql/01_setup.sql`)
- [ ] Load 13,501 recipes with dlt (`pipelines/load_recipes.py`)
- [ ] Verify with `SELECT COUNT(*)` — **this much is pure data engineering**

### Phase 2 — Indexing (first half of RAG)
- [ ] Generate flavor profiles with CORTEX.COMPLETE (`sql/02_enrich.sql`)
  - ⚠️ Start with `LIMIT 20`. Running all 13,501 up front burns credits for nothing.
- [ ] Generate embeddings with AI_EMBED (`sql/03_embed.sql`)

### Phase 3 — Retrieval (second half of RAG)
- [ ] Cosine-similarity Top-K query (`archive/04_search_v1.sql`)
- [ ] Type a real query in SQL and read the results
  - **This is the highlight of the project** — RAG working with no UI at all, just SQL

### Phase 4 — Generation + UI
- [ ] Generate grounded explanations with CORTEX.COMPLETE
- [ ] Streamlit app (`archive/streamlit_app_v1.py`)

### Phase 5 — Evaluation (⭐ the resume differentiator — do not skip)

Most RAG portfolio projects stop at Phase 4. This phase is what separates
*"I built a RAG app"* from *"I measured retrieval quality and can defend the design."*

**Three arms to compare.** Arm A exists to test whether this project's central claim —
that document enrichment matters — is actually true. If A ≈ B, the core idea is wrong and
that is *still* a finding worth reporting honestly.

| Arm | What is embedded | Retrieval | Question it answers |
|---|---|---|---|
| **A** (baseline) | raw ingredient list | pure vector | Does enrichment matter at all? |
| **B** (our approach) | sensory + context profile | pure vector | How much does enrichment help? |
| **C** (upgrade) | sensory + context profile | Cortex Search hybrid | Does keyword+vector beat vector alone? |
| **D** (ablation) | sensory profile **only** | pure vector | Is the inferred context worth its hallucination risk? |

Arm D exists because enrichment produces two different kinds of text. `sensory_profile` is
grounded in the source; `context_profile` (temperature, season, occasion) is largely the model's
own knowledge, and is where the observed hallucinations clustered. D vs B measures exactly what
that inferred context buys: it should help occasion queries ("cozy for a rainy day") and do
nothing for sensory ones. If D ≈ B overall, the risky half is not earning its place.

**Building the eval set** (`eval/queries.yml`)

Ground truth is the hard part of RAG evaluation — for each query you must know which recipes
*should* have been returned.

1. Freeze a **fixed subset** (e.g. 200 enriched recipes). Hand-labeling against all 13,501 is
   not realistic; a smaller, fully-labeled corpus gives more trustworthy numbers than a large
   partially-labeled one.
2. Write ~20 queries spanning categories: sensory, occasion, dietary constraint, cross-lingual.
3. Label relevant recipes per query. To speed this up, use an LLM to pre-screen candidates,
   then verify by hand — and **state in the README that labels were LLM-assisted**, since that
   introduces bias toward what an LLM considers similar.

**Metric**

```
Recall@5 = (relevant recipes appearing in top 5) / min(5, total relevant for that query)
```

Report the mean across all queries, per arm. Also record **failure cases** — the 3-5 queries
with the worst recall, and a one-line diagnosis of why. A candidate who can articulate where
their own system breaks reads as far more senior than one who only shows the happy path.

**Also worth recording:** credits consumed for indexing and per query. Cost per query is a
conversation data teams have constantly, and almost no portfolio project reports it.

### Phase 6 — Constrained retrieval (optional, high value)

Add a `PANTRY` table of ingredients on hand, and answer *"something refreshing **that I can
actually make tonight**."* This is more interesting than it sounds: it turns pure semantic
search into **filtered vector search**, which has a genuine engineering tradeoff.

| Strategy | How | Failure mode |
|---|---|---|
| **Post-filter** | retrieve top-K by similarity, then drop unmakeable ones | can return *nothing* if all K are unmakeable |
| **Pre-filter** | restrict to makeable recipes first, then rank | correct, but scans far more rows |

Implement both, measure recall and latency for each, and explain when you would choose which.
This tradeoff is well known in production vector search and rarely shows up in a portfolio.

> Note: the pantry can be a hand-written table. **Nothing here requires receipt scanning** —
> the interesting engineering is the filtering, not the data entry.

### Phase 7 — Receipt ingestion (optional, do last)

Photo of a grocery receipt → OCR / multimodal LLM → normalized items → `PANTRY` table.

This adds a genuine multimodal component and a *second* dlt source with a different shape and
cadence, which strengthens the pipeline story. But it is also the most tedious part (real
receipts are messy, and item names need normalizing: `"ORG BAN 3LB"` → `banana`), and it adds
no retrieval-quality insight. **Build it only after Phases 5 and 6 are done.**

### Phase 8 — Live REST API source (the most transferable skill here)

Both current sources are static CSVs downloaded once. A real ingestion pipeline pulls from a
live API with pagination, rate limits, and incremental loading — which is what dlt's
`rest_api` source is built for, and the single most transferable piece of this project to a
data-engineering role.

Good target: **TheMealDB** — a free public API covering ~195 cuisines/areas, with ingredients
per dish. Wikipedia and Wikidata APIs are also fair game.

This is not only about realism. It is the actual fix for the index-time hallucination problem
above: international dishes currently have only a short description to work from, so the model
invents. An API that supplies real ingredients per dish gives the enrichment step something to
be grounded in, which no amount of prompt tuning can substitute for.

> **Do not scrape HTML for this.** Most recipe sites prohibit scraping in their terms, and a
> terms-violating scraper sitting in a portfolio repo reads as a judgment problem to a hiring
> manager rather than as initiative. Public APIs and published `schema.org/Recipe` JSON-LD are
> designed to be consumed; use those.

### Phase 9 — Deployment, two tiers   ✅ 2026-08-26

The measured system is live, and public without an unbounded bill. One Docker image
([Dockerfile](../Dockerfile)) builds the React app and serves it with the live API from a
single process; Snowflake credentials come from env vars (inline PEM key), so no secret file
ships. The **live app** (`cravingrag.com`) is hosted on Render behind **Cloudflare Access**:
only allowlisted emails get in via a one-time email code, which is credit control as much as
privacy since every `/search` is a real Cortex call. A second **public tier**
([demo.cravingrag.com](https://demo.cravingrag.com)) serves a precomputed gallery: the same
app built with `VITE_PUBLIC_GALLERY=1` replays 20 curated cravings from a bundled
`gallery.json` (generated once by `ui/build_gallery.py`), static on Cloudflare Pages, zero
Snowflake cost. This is the infra half of the "live REST API source" transferable-skill
argument in Phase 8: a deployed, access-controlled front door, plus a free public showpiece.
Details in DECISIONS §10 and the README "Deployment" section.

---

## 7. Findings

Everything below was observed on this corpus and, where stated, reproduced with a
controlled experiment. They fall into three groups, and the grouping is itself the point:
**most failures were design mistakes, a few are properties of the technology, and telling
them apart is a skill of its own.**

### A. Failures caused by how the text was indexed — all fixable

| Finding | Evidence | Fix |
|---|---|---|
| Prose format destroys retrieval | Top-10 compressed into 0.516–0.416; a fried pastry scored like a fruit slush | Terse noun-dense profiles → 9/10 relevant |
| Dish identity must be in the indexed text | "describe ONLY taste and texture" removed the words *soup* and *broth*, so kal-guksu could not match "warm broth" | Name the dish type first |
| Enrichment hallucinates when the source is thin | Jjinppang described as "earthy"; stuffed melon as "cool" alongside "warm stuffing" | Grounding clause; drop sources under 80 chars |
| Generic profiles become hubs | "Nice biscuit" appeared in 6 of 20 query pools, including two contradictory ones | Terse format cut hubs to 2 of 200 pool entries |

### B. Failures inherent to vector retrieval — not fixable by prompting

**Ranking collapses onto lexical overlap.** For *"something refreshing and bursting with
juice"*, the twelve candidates partitioned perfectly by whether their profile contained the
literal word "refreshing": ranks 1–7 all did, ranks 8–12 all did not. Whether a profile said
"juicy" predicted nothing. A tomato salad whose profile literally reads *"Juicy, crunchy,
creamy"* lost to margaritas.

**Ingredient and texture are not distinguished.** A margarita listing *"lime juice"* as an
ingredient outranks a tomato salad described as *"juicy"*. Removing "refreshing" from the
query did not flip this — the drinks match "juice" lexically too.

**Vocabulary outside the corpus fails entirely.** Querying *"firm food that squirts liquid
when you bite into it"* returned water biscuits, breadsticks and digestive biscuits — dry
goods, the opposite of the request. No profile contains "squirts", so the model fell back to
matching "firm". The concept exists in the corpus ("juicy"); the wording does not.

**Negation is not representable.** *"vegetarian, no meat at all"* returns a hamburger and a
kebab. *"no oven required"* returns a soufflé and a pretzel, matching the literal token "No-"
in titles like "No-Knead Pizza Dough" rather than the concept.

**Idiomatic phrases lose their conventional referent.** *"crispy on the outside, tender
inside"* conventionally describes fried or roasted protein; it returned croissants and Nice
biscuits. The embedding captures word meaning but not what the phrase is used to mean.

### C. Findings about how to measure honestly

**Always check the corpus before blaming the retriever.** A Korean query for hangover broth
returned vindaloo and a cold slaw, which reads as broken cross-lingual retrieval. It was not:
only ~14% of world dishes had been enriched, so roughly 2 of 15 Korean soups existed as
vectors. There was nothing to find. This mistake was made twice before it became a habit to
check coverage first.

**Absolute similarity is not interpretable; ranking is.** Terse profiles scored *lower* at
rank 1 (0.494 vs 0.516) while returning far better results. Unrelated text bottoms out around
0.495 on this model, so any threshold like "below 0.5 means no match" rejects everything.
Within a fixed index the top score does seem to track quality — 0.606 for a query answered
well, 0.460 for one answered badly — but that is a within-index signal only.

**A right answer can come from a wrong mechanism.** "Fish ball" ranked first for the
squirts-liquid query and is arguably a fine answer — fish balls do release broth. But its
profile says only *"Chewy, firm"*; the system matched "firm" and got lucky. Recall counts it
as a hit, so the metric flatters the system.

**Some queries have no single right answer, which caps achievable recall.** Reasonable people
would return different sets for *"refreshing and bursting with juice"* — cherry tomatoes,
watermelon salad, grapefruit, agua fresca are all defensible. Without measuring
inter-annotator agreement, a Recall@5 of 65% cannot be read: the ceiling might be 100% or it
might be 75%. Judging a subset twice is the cheap fix and it is a stated next step.

---

## 8. Resume line

Lead with what was learned, not with the app. The app is the apparatus; the findings are the
work.

> **CravingRAG** — A study of why RAG retrieval fails, built on Snowflake Cortex. Ingested
> 15K dishes from two sources with dlt, indexed them via LLM document enrichment, and ran
> controlled experiments to isolate five distinct failure modes — including a demonstration
> that ranking collapses onto lexical overlap: the top-12 results partitioned perfectly by
> whether a single query word appeared literally in the profile, while the semantically
> relevant word predicted nothing. Rewriting indexed text from prose to terse noun-dense
> form took top-10 relevance from roughly 3/10 to 9/10. Benchmarked Recall@5 across four
> retrieval configurations using pooled relevance judgment.

> ⚠️ Keep every number in that paragraph traceable to something in this repo. The 3/10 is an
> informal count of the pre-rewrite top 10 and should be labelled as such — or replaced with
> the measured Recall@5 once Phase 5 is done. Do not let a convenient number outrun its
> evidence.

Why this framing: "I built a recipe search app" invites the obvious objection — ChatGPT
answers *"recommend something refreshing"* better than this ever will. That objection is
correct and beside the point. What ChatGPT cannot do is retrieve from a corpus it has never
seen, cite which of 15,000 specific documents matched, or be measured. The recipe corpus is a
stand-in; the transferable output is knowing that a retrieval system returning garbage is
usually failing at its indexing format, its corpus coverage, or its query semantics — and
knowing how to tell which.

---

## 9. Deliberately out of scope

Already demonstrated in a previous project (PantryAI), and would dilute the focus here:
- ❌ user auth / social features / meal planner
- ❌ recipe *generation* — this project retrieves real recipes; inventing them is the
  opposite of what it is trying to prove

Pantry inventory is **not** excluded, but it enters as a *retrieval constraint* (Phase 6),
not as an inventory-management feature. The distinction matters: the value is in filtered
vector search, not in CRUD over a pantry list.

This project is about the **data layer and retrieval quality**. Every phase should either
improve retrieval or measure it.

Cloudflare Access (Phase 9) is not a reversal of the "no user auth" line above: it gates the
whole demo at the infrastructure edge (who may open the URL), not per-user accounts,
profiles, or social features inside the app. The app still has no notion of a logged-in user.
