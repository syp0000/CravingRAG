# 🍊 CravingRAG

**Describe a craving in plain language — get real recipes back, with reasons.**

> "something refreshing and bursting with juice" → 3 matching recipes + why each fits

한국어 문서: [README.ko.md](README.ko.md) · [DESIGN.ko.md](DESIGN.ko.md)

---

## What this is

A retrieval-augmented generation (RAG) pipeline built entirely inside Snowflake. Keyword search
cannot answer *"something refreshing and bursting with juice"* — that requires semantic search
over embeddings. This project makes that work, and measures how well.

The key idea: instead of embedding raw ingredient lists (which never match sensory queries), an
LLM first rewrites every recipe into a **sensory flavor profile**, and *that* is what gets
indexed. See [DESIGN.md](DESIGN.md) for the full rationale.

**Stack:** dlt · Snowflake (VECTOR, Cortex `AI_EMBED` + `COMPLETE`, Cortex Search) · Streamlit
**No external API keys. No separate vector database.**

---

## Architecture

```
HuggingFace recipe_nlg_lite (7,198 recipes)
        │  dlt — schema inference, merge by uid
        ▼
   RAW.RECIPES
        │  CORTEX.COMPLETE — generate sensory flavor profile
        ▼
   ENRICHED.RECIPE_PROFILES
        │  AI_EMBED — multilingual embeddings
        ▼
   SEARCH.RECIPE_VECTORS  (VECTOR(FLOAT, 1024))
        │  VECTOR_COSINE_SIMILARITY — Top-K retrieval
        │  CORTEX.COMPLETE — grounded explanation
        ▼
   Streamlit UI
```

---

## Setup

### 1. Snowflake account
Sign up for a [Snowflake free trial](https://signup.snowflake.com/) (30 days, $400 credits, no
card required). Pick a region where Cortex is available — `AWS us-west-2` is a safe default.

### 2. Python environment
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Snowflake connection
Create `~/.snowflake/connections.toml`:
```toml
[craving]
account   = "YOUR_ACCOUNT_ID"
user      = "YOUR_USER"
password  = "YOUR_PASSWORD"
warehouse = "CRAVING_WH"
database  = "CRAVING_RAG"
role      = "ACCOUNTADMIN"
```

dlt reads credentials separately — create `.dlt/secrets.toml` with the same values under
`[destination.snowflake.credentials]`.

> Both files are gitignored. Never commit credentials.

---

## Running it

Run the phases in order. Each one is independently verifiable.

| # | Step | Command |
|---|---|---|
| 1 | Create warehouse, database, schemas | run `sql/01_setup.sql` in Snowsight |
| 2 | Load recipes | `python pipelines/load_recipes.py --limit 50` |
| 3 | Generate flavor profiles | run `sql/02_enrich.sql` |
| 4 | Generate embeddings | run `sql/03_embed.sql` |
| 5 | Search + explain | run `sql/04_search.sql` |
| 6 | Launch the UI | `streamlit run app/streamlit_app.py` |

> ⚠️ **Start small.** Use `--limit 50` and keep `LIMIT 20` in `02_enrich.sql` on the first pass.
> Running the LLM over all 7,198 recipes before validating the prompt wastes credits.
> Also set `AUTO_SUSPEND = 60` on the warehouse (step 1 does this) so idle time is not billed.

---

## Project status

- [ ] Phase 1 — dlt ingestion
- [ ] Phase 2 — LLM document enrichment
- [ ] Phase 3 — vector retrieval
- [ ] Phase 4 — grounded generation + Streamlit UI
- [ ] Phase 5 — Cortex Search hybrid retrieval + Recall@5 benchmark

---

## Repo layout

```
sql/
  01_setup.sql      account setup, Cortex availability check
  02_enrich.sql     ⭐ LLM document enrichment (the core idea)
  03_embed.sql      embeddings + an intuition-building similarity experiment
  04_search.sql     retrieval + grounded generation, in pure SQL
pipelines/
  load_recipes.py   dlt ingestion
app/
  streamlit_app.py  UI
DESIGN.md           full design rationale — read this first
```
