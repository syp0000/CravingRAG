"""
Phase 4 — CravingRAG UI

Run:
    streamlit run app/streamlit_app.py

⚠️ Do not start here. Finish Phases 1-3 first and confirm retrieval works in plain SQL.
   Building the UI before the retrieval is proven makes debugging much harder.
"""

import streamlit as st
from snowflake.snowpark import Session

EMBED_MODEL = "snowflake-arctic-embed-l-v2.0"   # must be multilingual
LLM_MODEL = "mistral-large2"
TOP_K = 5


@st.cache_resource
def get_session() -> Session:
    """Uses the connection defined in ~/.snowflake/connections.toml."""
    # TODO: add a [craving] connection to connections.toml (see README)
    return Session.builder.config("connection_name", "craving").create()


def retrieve(session: Session, query: str, k: int = TOP_K):
    """① RETRIEVAL — the Top-K recipes semantically closest to the query."""
    sql = f"""
        SELECT
            name,
            ingredients,
            flavor_profile,
            VECTOR_COSINE_SIMILARITY(
                profile_vec,
                AI_EMBED('{EMBED_MODEL}', ?)
            ) AS similarity
        FROM CRAVING_RAG.SEARCH.RECIPE_VECTORS
        ORDER BY similarity DESC
        LIMIT {k}
    """
    return session.sql(sql, params=[query]).collect()


def explain(session: Session, query: str, rows) -> str:
    """② GENERATION — explain the matches, grounded only in retrieved recipes."""
    context = "\n".join(f"- {r['NAME']}: {r['FLAVOR_PROFILE']}" for r in rows)

    prompt = (
        f'The user wants: "{query}"\n\n'
        f"Retrieved recipe candidates:\n{context}\n\n"
        "Pick the best matches and explain in one sentence each why they fit. "
        "Use ONLY recipes from the list above. Do not invent recipes."
    )

    result = session.sql(
        f"SELECT SNOWFLAKE.CORTEX.COMPLETE('{LLM_MODEL}', ?) AS answer",
        params=[prompt],
    ).collect()
    return result[0]["ANSWER"]


# ------------------------------------------------------------------
# UI
# ------------------------------------------------------------------
st.set_page_config(page_title="CravingRAG", page_icon="🍊")
st.title("🍊 CravingRAG")
st.caption("Describe how you want to feel about your food — get real recipes back")

query = st.text_input(
    "What are you craving?",
    placeholder="e.g. refreshing and bursting with juice / warm broth for a hangover",
)

if query:
    session = get_session()

    with st.spinner("Searching by meaning..."):
        rows = retrieve(session, query)

    with st.spinner("Writing recommendations..."):
        st.markdown("### Recommendations")
        st.write(explain(session, query, rows))

    # Always show what was retrieved — RAG systems should expose their evidence.
    with st.expander(f"🔍 {len(rows)} retrieved recipes (by similarity)"):
        for r in rows:
            st.markdown(f"**{r['NAME']}**  ·  similarity `{r['SIMILARITY']:.3f}`")
            st.caption(r["FLAVOR_PROFILE"])
            st.divider()

# TODO (improvement): if every similarity is low (say < 0.5), say "no good match found"
#   instead of recommending anyway. Without this guard, RAG confidently returns junk.
