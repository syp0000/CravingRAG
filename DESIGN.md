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

---

## 3. End-to-end data flow

```
 [HuggingFace] recipe_nlg_lite (7,198 recipes)
        │
        │  dlt  — incremental load, schema inference, merge by uid
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
- [ ] Load 7,198 recipes with dlt (`pipelines/load_recipes.py`)
- [ ] Verify with `SELECT COUNT(*)` — **this much is pure data engineering**

### Phase 2 — Indexing (first half of RAG)
- [ ] Generate flavor profiles with CORTEX.COMPLETE (`sql/02_enrich.sql`)
  - ⚠️ Start with `LIMIT 20`. Running all 7,198 up front burns credits for nothing.
- [ ] Generate embeddings with AI_EMBED (`sql/03_embed.sql`)

### Phase 3 — Retrieval (second half of RAG)
- [ ] Cosine-similarity Top-K query (`sql/04_search.sql`)
- [ ] Type a real query in SQL and read the results
  - **This is the highlight of the project** — RAG working with no UI at all, just SQL

### Phase 4 — Generation + UI
- [ ] Generate grounded explanations with CORTEX.COMPLETE
- [ ] Streamlit app (`app/streamlit_app.py`)

### Phase 5 — Evaluation (⭐ the resume differentiator — do not skip)

Most RAG portfolio projects stop at Phase 4. This phase is what separates
*"I built a RAG app"* from *"I measured retrieval quality and can defend the design."*

**Three arms to compare.** Arm A exists to test whether this project's central claim —
that document enrichment matters — is actually true. If A ≈ B, the core idea is wrong and
that is *still* a finding worth reporting honestly.

| Arm | What is embedded | Retrieval | Question it answers |
|---|---|---|---|
| **A** (baseline) | raw ingredient list | pure vector | Does enrichment matter at all? |
| **B** (our approach) | LLM flavor profile | pure vector | How much does enrichment help? |
| **C** (upgrade) | LLM flavor profile | Cortex Search hybrid | Does keyword+vector beat vector alone? |

**Building the eval set** (`eval/queries.yml`)

Ground truth is the hard part of RAG evaluation — for each query you must know which recipes
*should* have been returned.

1. Freeze a **fixed subset** (e.g. 200 enriched recipes). Hand-labeling against all 7,198 is
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

---

## 7. Resume line

> **CravingRAG** — Cross-lingual RAG retrieval pipeline on Snowflake Cortex. Ingested 7K
> recipes with dlt and applied LLM-based document enrichment to generate sensory flavor
> profiles for indexing, enabling emotional natural-language queries ("refreshing and bursting
> with juice") to retrieve from an English recipe corpus. Benchmarked Recall@5 of pure vector
> search against hybrid search.

---

## 8. Deliberately out of scope

Already demonstrated in a previous project (PantryAI), and would dilute the focus here:
- ❌ user auth / social features / meal planner
- ❌ recipe *generation* — this project retrieves real recipes; inventing them is the
  opposite of what it is trying to prove

Pantry inventory is **not** excluded, but it enters as a *retrieval constraint* (Phase 6),
not as an inventory-management feature. The distinction matters: the value is in filtered
vector search, not in CRUD over a pantry list.

This project is about the **data layer and retrieval quality**. Every phase should either
improve retrieval or measure it.
