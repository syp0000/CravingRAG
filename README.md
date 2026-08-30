# CravingRAG

**Describe what you want to eat in everyday language. Get real recipes back, with the
ingredient evidence behind each match.**

[Try the public demo](https://demo.cravingrag.com)

> "Warm spicy soup, no shellfish" becomes a short list of real recipes. Each result
> explains which flavors matched and which ingredient lines support that explanation.

## What does it do?

CravingRAG searches 20,000 real recipes. It does not invent dishes or write new recipes.

A person can describe a feeling, flavor, texture, or restriction, such as:

- "Something light and fresh"
- "A cozy Korean stew"
- "Chocolate dessert, no almonds"
- "Savory noodle soup"

The app returns up to five recipes. It can also show evidence such as:

```text
spicy 0.8
because the recipe contains: "10 Thai chile peppers, seeded and minced"
```

The public demo uses 20 saved searches, so anyone can try it without creating a paid AI
request. The invite-only live version accepts any search phrase.

## Why did I build it?

An earlier project generated recipes with an AI model. The recipes often satisfied every
written requirement but still did not feel believable as food.

CravingRAG tests a different idea: search real recipes instead of generating new ones.
The main question is whether a search system can understand how a person wants food to
feel, while still respecting clear restrictions such as "no peanuts."

## How does a search work?

### 1. Read each recipe once

Snowflake Cortex reads each recipe and records eight qualities:

```text
spicy, warm, rich, fresh, sweet, brothy, savory, comforting
```

Each score must include an ingredient or instruction line as evidence. If there is no
evidence, the score is left empty.

### 2. Compare meanings

The system converts recipes and the search phrase into number lists called embeddings.
Embeddings place similar meanings near each other. This lets "cozy noodle bowl" find a
ramen recipe even when the recipe never uses the word "cozy."

### 3. Enforce exclusions separately

Meaning-based search is not reliable for negative phrases. A search for "no almonds" can
accidentally find almond recipes because the word "almonds" is present.

CravingRAG therefore checks the real title and ingredient text. A recipe is removed when
it contains an excluded ingredient. This is a preference filter, not medical or allergy
advice.

### 4. Remove clearly poor results

A small quality layer removes drinks when the person asked for food, recipe components
when the person asked for a full dish, identity mismatches, and repeated versions of the
same dish family.

This layer is called Lean V3. It improves the displayed results, but it has not been given
a new paper-style performance score. The published scores below still belong to the
frozen V2 evaluation.

## What did the evaluation find?

Four search methods were tested on the same 15 search phrases and the same 342-recipe
development collection. A human reviewer scored 386 query and recipe pairs without seeing
which method produced them.

| Search method | NDCG@5 | Precision@5 |
|---|---:|---:|
| Raw recipe text embedding | 0.582 | 0.560 |
| Structured eight-quality scoring | 0.698 | 0.747 |
| AI-written sensory profile embedding | 0.732 | 0.773 |
| **Sensory profile embedding plus hard exclusion** | **0.844** | **0.880** |

Both scores range from 0 to 1, and higher is better.

- **Precision@5** asks how many of the first five results were judged relevant.
- **NDCG@5** also rewards the system for placing the best results first.

The complete results are in [eval/results_v2.md](eval/results_v2.md).

### What the numbers mean

1. Rewriting recipes into sensory language improved NDCG@5 by 0.150 over raw recipe text.
2. The hard ingredient exclusion was the largest improvement. It raised exclusion-query
   NDCG from 0.245 to 0.855.
3. The structured quality scores were useful for evidence and filtering, but they were not
   the best ranking method. They understand intensity, such as "very spicy," better than
   dish identity, such as "noodle soup."
4. The exclusion improvement has a wide confidence interval because there were only 15
   test phrases. More independent queries are needed before making a broad research claim.

The project intentionally keeps the weak results and uncertainty visible. See the
[baseline report](eval/results_baseline.md), [V2 report](eval/results_v2.md), and
[judging rules](eval/JUDGING.md).

## From 342 recipes to 20,000

The small collection was used for controlled evaluation. The same enrichment pipeline
was later run on 20,000 recipes.

- A 1,000-recipe trial cost $4.55.
- The full 20,000-recipe run took 21 minutes and cost about $90.
- Every non-empty score still had evidence.

The larger collection fixed some coverage problems but exposed new ones. Drinks appeared
in food searches, and near-duplicate recipes filled the result list. Those failures led to
the Lean V3 quality layer.

The evaluation score of 0.844 belongs only to the 342-recipe development collection. It
must not be presented as a score for the 20,000-recipe live collection.

## What can you see in the app?

The React app has three pages:

- **Search:** Find recipes and inspect why each one matched.
- **Catalog:** Compare simulated demand with the real recipe supply.
- **About:** See the pipeline, evaluation, and limitations in plain language.

Every search also creates a decision record. The record stores how the query was
interpreted, which candidates were rejected, why they were rejected, and which recipes
were selected. Recording is optional and never blocks a search.

## Public gallery and live search

### Public gallery

[demo.cravingrag.com](https://demo.cravingrag.com) is open to everyone. It reads 20 saved
results from `gallery.json` and never contacts Snowflake during a visit.

The saved queries were parsed with the V2 parser. Their final recipe lists were regenerated
after the Lean V3 quality layer was added.

### Invite-only live app

The live version accepts any search phrase and makes paid Snowflake Cortex calls. It sits
behind Cloudflare Access so only approved email addresses can use it. The server uses a
least-privilege Snowflake role defined in [sql/17_app_role.sql](sql/17_app_role.sql).

## Catalog planning example

The same recipe scores can answer a business question: what do people ask for that the
catalog does not provide?

The current demand data is synthetic. No real customer behavior is claimed. Three clearly
labeled scenarios generate 3,000 sample searches. The Catalog page compares those searches
with the real recipe supply.

For example, the Phoenix summer scenario asks for fresh and spicy food much more often than
the catalog provides it. This demonstrates how the search data could support a menu or
content decision once real usage data exists.

## Important limitations

- The evaluation used 15 development queries, not an independent public benchmark.
- One person performed the main relevance judgments.
- The 342-recipe score does not measure the 20,000-recipe live collection.
- AI-extracted qualities and evidence can be wrong.
- Ingredient exclusion is a preference filter, not allergy or medical guidance.
- Lean V3 uses narrow runtime rules and does not have a separate NDCG score.
- Synthetic demand demonstrates the workflow but does not represent real customers.
- The demand table counts recipe variants separately, so supply can be overstated.

Possible full V3 research is documented as future work in
[docs/PLAN.md](docs/PLAN.md). It would require a new recipe and query representation, an
independent holdout query set, another reviewer, full ablations, and a new evaluation over
the same frozen 20,000-recipe collection.

## Architecture

[![CravingRAG system data flow](docs/diagrams/craving-pipeline.png)](docs/diagrams/craving-pipeline.html)

Open the [interactive architecture diagram](docs/diagrams/craving-pipeline.html) for more
detail.

## Documentation

The root folder keeps only the files needed to understand, install, and run the project.
Detailed project records live in [`docs/`](docs/README.md).

| Document | Purpose |
|---|---|
| [docs/DESIGN.md](docs/DESIGN.md) | Original design and the V1 failures that motivated V2 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture choices and rejected alternatives |
| [docs/PLAN.md](docs/PLAN.md) | Build history, scale-up procedure, known limits, and future work |
| [eval/](eval/) | Frozen queries, judgments, evaluation scripts, and result reports |

## Development

### Requirements

- Python 3.12
- Node.js 20 or newer. CI uses Node.js 22.
- Snowflake credentials only for live searches, data pipelines, and evaluation queries

Python dependencies are grouped by purpose in [`requirements/`](requirements/).

| File | Install it when you need to |
|---|---|
| `requirements/dev.txt` | Run tests and the local server |
| `requirements/deploy.txt` | Build only the live server container |
| `requirements/pipeline.txt` | Rebuild data, enrichment, or evaluation tables |

### Local setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements/dev.txt
cp .dlt/example.secrets.toml .dlt/secrets.toml
chmod 600 .dlt/secrets.toml
cd ui/app && npm ci && npm run build && cd ../..
.venv/bin/python ui/server.py
```

Open `http://localhost:8642`.

Snowflake credentials are not needed for the automated test suite. They are needed when
running the live server because live searches call Snowflake Cortex.

Install the additional pipeline dependencies only when rebuilding the data:

```bash
pip install -r requirements/pipeline.txt
```

### Checks

```bash
scripts/verify.sh
python pipelines/compile_wiki.py --check
```

`scripts/verify.sh` runs Python tests, frontend lint, frontend tests, and the production
frontend build. Tests use a fake Snowflake connection and make no paid calls.

Optional Sonar analysis reads [sonar-project.properties](sonar-project.properties) and the
Python and frontend coverage reports:

```bash
sonar-scanner
```

GitHub Actions runs the Python and frontend jobs on every push and pull request. The Sonar
job runs only when `SONAR_TOKEN` is configured. SonarCloud also requires the
`SONAR_ORGANIZATION` repository variable.

### Security boundary

The live deployment relies on Cloudflare Access for authentication. The Python server also
limits query size, accepted filter values, statement time, and socket time. It returns a
fixed public error message while keeping detailed errors in server logs.

There is no per-user rate limit inside the Python server. If the live audience grows beyond
a small trusted group, add a Cloudflare rate rule or a server-side token bucket before
opening access.

## Repository map

```text
docs/          design, decisions, project history, and architecture diagrams
requirements/  separate dependency profiles for development, deployment, and pipelines
eval/          frozen queries, human judgments, metrics, and result reports
pipelines/     curation, loading, wiki compilation, and synthetic demand tools
sql/           Snowflake setup, enrichment, retrieval, evaluation, and analytics
wiki/          human-editable craving concepts and their quality mappings
ui/            Python server, search pipeline, quality checks, React app, and tests
provenance/    decision records and trace tools
archive/       retired V1 code, prototypes, and historical Korean documents
```

The complete Snowflake build order and cost controls are recorded in
[docs/PLAN.md](docs/PLAN.md).

## Technology

- Python, React, Vite, and GSAP
- Snowflake Cortex, vector similarity, semantic views, and Cortex Analyst
- Docker, Render, Cloudflare Pages, and Cloudflare Access
- Pytest, Vitest, Testing Library, GitHub Actions, and SonarQube

There is no external LLM API and no separate vector database.

## Data and licenses

The recipe collection comes from RecipeNLG by Poznan University of Technology. It is used
for non-commercial research and education. Recipe-derived data stays local and is not
included in Git.

Search demand is synthetic and every generated row is labeled `synthetic_demo`.

Project source code is licensed under [MIT](LICENSE). RecipeNLG data, generated media, and
third-party dependencies keep their own terms.

| Third-party item | Use |
|---|---|
| [GSAP](https://gsap.com) and `@gsap/react` | Interface animation |
| [archify](https://github.com/tt-a1i/archify) | Architecture diagram |
| [Semantica](https://github.com/semantica-agi/semantica) | Optional decision-record backend |
| React and Vite | Web interface |
| `dlt`, Snowflake connector, and pandas | Data loading and processing |
| Snowflake Cortex | Enrichment, embeddings, and analytics |
| Google Flow with Veo | Background videos created for this project |

See [docs/DECISIONS.md](docs/DECISIONS.md) for the detailed technical reasoning and
[docs/PLAN.md](docs/PLAN.md) for the full project history.
