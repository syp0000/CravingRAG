# 🍊 CravingRAG

**먹고 싶은 '느낌'을 말하면, 실제 레시피를 이유와 함께 찾아준다.**

> "상큼하고 과즙이 터지는" → 어울리는 레시피 3개 + 각각 왜 맞는지

*English version: [README.md](README.md) · [DESIGN.md](DESIGN.md)*

---

## 이게 뭔가요

Snowflake 안에서 전부 돌아가는 RAG(검색 증강 생성) 파이프라인입니다.
*"상큼하고 과즙이 터지는"* 같은 쿼리는 키워드 검색으로 절대 안 풀립니다 — 임베딩 기반
의미 검색이 필요하죠. 이 프로젝트는 그걸 실제로 동작하게 만들고, 얼마나 잘 되는지 측정합니다.

핵심 아이디어: 재료 목록을 그대로 임베딩하면 감각적 쿼리와 매칭이 안 되므로,
LLM이 먼저 각 레시피를 **감각 묘사(flavor profile)** 로 다시 쓰고 **그걸** 인덱싱합니다.
자세한 근거는 [DESIGN.ko.md](DESIGN.ko.md) 참고.

**스택:** dlt · Snowflake (VECTOR, Cortex `AI_EMBED` + `COMPLETE`, Cortex Search) · Streamlit
**외부 API 키 0개. 별도 벡터 DB 0개.**

---

## 아키텍처

```
HuggingFace recipe_nlg_lite (레시피 7,198개)
        │  dlt — 스키마 추론, uid 기준 merge
        ▼
   RAW.RECIPES
        │  CORTEX.COMPLETE — 감각 묘사 생성
        ▼
   ENRICHED.RECIPE_PROFILES
        │  AI_EMBED — 다국어 임베딩
        ▼
   SEARCH.RECIPE_VECTORS  (VECTOR(FLOAT, 1024))
        │  VECTOR_COSINE_SIMILARITY — Top-K 검색
        │  CORTEX.COMPLETE — 근거 기반 설명 생성
        ▼
   Streamlit UI
```

---

## 세팅

### 1. Snowflake 계정
[Snowflake 무료 트라이얼](https://signup.snowflake.com/) 가입 (30일, $400 크레딧, 카드 불필요).
**Cortex가 지원되는 리전**을 골라야 합니다 — `AWS us-west-2` 가 무난합니다.

### 2. 파이썬 환경
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Snowflake 연결 정보
`~/.snowflake/connections.toml` 생성:
```toml
[craving]
account   = "YOUR_ACCOUNT_ID"
user      = "YOUR_USER"
password  = "YOUR_PASSWORD"
warehouse = "CRAVING_WH"
database  = "CRAVING_RAG"
role      = "ACCOUNTADMIN"
```

dlt는 별도로 자격증명을 읽습니다 — `.dlt/secrets.toml` 에 같은 값을
`[destination.snowflake.credentials]` 아래에 넣어주세요.

> 두 파일 모두 gitignore 되어 있습니다. **절대 커밋하지 마세요.**

---

## 실행 순서

순서대로 진행하세요. 각 단계는 독립적으로 확인 가능합니다.

| # | 단계 | 명령 |
|---|---|---|
| 1 | 웨어하우스·DB·스키마 생성 | Snowsight에서 `sql/01_setup.sql` 실행 |
| 2 | 레시피 적재 | `python pipelines/load_recipes.py --limit 50` |
| 3 | 감각 묘사 생성 | `sql/02_enrich.sql` 실행 |
| 4 | 임베딩 생성 | `sql/03_embed.sql` 실행 |
| 5 | 검색 + 설명 생성 | `sql/04_search.sql` 실행 |
| 6 | UI 실행 | `streamlit run app/streamlit_app.py` |

> ⚠️ **작게 시작하세요.** 처음엔 `--limit 50`, `02_enrich.sql`의 `LIMIT 20` 을 유지하세요.
> 프롬프트 품질도 확인 안 하고 7,198개 전체에 LLM을 돌리면 크레딧이 그냥 날아갑니다.
> 웨어하우스 `AUTO_SUSPEND = 60` 도 꼭 설정하세요 (1단계에 포함됨) — 놀고 있는 시간에
> 과금되지 않게 하는 가장 중요한 설정입니다.

---

## 진행 상황

- [ ] Phase 1 — dlt 적재
- [ ] Phase 2 — LLM 문서 강화
- [ ] Phase 3 — 벡터 검색
- [ ] Phase 4 — 근거 기반 생성 + Streamlit UI
- [ ] Phase 5 — Cortex Search 하이브리드 검색 + Recall@5 벤치마크

---

## 폴더 구조

```
sql/
  01_setup.sql      계정 세팅, Cortex 사용 가능 여부 확인
  02_enrich.sql     ⭐ LLM 문서 강화 (핵심 아이디어)
  03_embed.sql      임베딩 + 직관을 잡아주는 유사도 실험
  04_search.sql     순수 SQL만으로 검색 + 근거 기반 생성
pipelines/
  load_recipes.py   dlt 적재
app/
  streamlit_app.py  UI
DESIGN.ko.md        전체 설계 근거 — 이걸 먼저 읽으세요
```
