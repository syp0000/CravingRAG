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
HuggingFace kaggle_food_recipes (레시피 13,501개)
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

## 각 부분이 어디서 도는가

여기서 많이 헷갈리니 분명히 짚고 갑니다: **dlt는 Snowflake 안에서 돌지 않습니다.**
dlt는 외부 소스에서 데이터를 가져와 Snowflake *안으로 밀어넣는* 클라이언트라서, 내 노트북에서
돕니다. Snowflake에서 도는 건 SQL뿐입니다.

| 구성요소 | 실행 위치 | 이유 |
|---|---|---|
| `pipelines/load_recipes.py` (dlt) | **내 노트북** (venv) | HuggingFace에 인터넷 접속 필요, Snowflake에는 클라이언트로 접속해 적재 |
| `sql/*.sql` | **Snowflake** (Snowsight 워크시트) | Cortex 함수와 벡터는 웨어하우스 안에 있음 |
| `app/streamlit_app.py` | 내 노트북 (또는 나중에 Streamlit in Snowflake) | Snowflake에 클라이언트로 질의 |

> dlt 스크립트를 Snowflake 노트북에서 돌리면 `ModuleNotFoundError: No module named 'dlt'` 가
> 납니다. **이걸 고치려고 노트북에 dlt를 설치하지 마세요** — Snowflake 노트북은 기본적으로
> 외부 인터넷 접속이 막혀 있어서 어차피 HuggingFace에 못 갑니다. 로컬에서 실행하세요.

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

dlt는 자격증명을 별도로 읽습니다. 템플릿을 복사해서 채우세요:
```bash
cp .dlt/example.secrets.toml .dlt/secrets.toml
```

> ⚠️ 여기서 두 가지가 꼭 문제가 됩니다:
> 1. `host` 는 **계정 식별자**(`kgiotue-wn98412`)이지 전체 URL이 아닙니다.
> 2. **비밀번호 인증은 안 됩니다.** Snowflake가 MFA를 강제해서 프로그래매틱 접속이 거부됩니다
>    (`MFA authentication is required...`). **키페어 인증**을 쓰세요 —
>    `.dlt/example.secrets.toml` 에 세팅 명령 3줄이 있습니다.

> `connections.toml` 과 `.dlt/secrets.toml` 둘 다 gitignore 되어 있습니다. **절대 커밋하지 마세요.**

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
> 프롬프트 품질도 확인 안 하고 13,501개 전체에 LLM을 돌리면 크레딧이 그냥 날아갑니다.
> 웨어하우스 `AUTO_SUSPEND = 60` 도 꼭 설정하세요 (1단계에 포함됨) — 놀고 있는 시간에
> 과금되지 않게 하는 가장 중요한 설정입니다.

---

## 진행 상황

- [ ] Phase 1 — dlt 적재
- [ ] Phase 2 — LLM 문서 강화
- [ ] Phase 3 — 벡터 검색
- [ ] Phase 4 — 근거 기반 생성 + Streamlit UI
- [ ] Phase 5 — ⭐ 평가: 3-arm Recall@5 벤치마크 (`eval/queries.yml`)
- [ ] Phase 6 — 제약 검색: 팬트리 필터, pre-filter vs post-filter
- [ ] Phase 7 — 영수증 사진 → 팬트리 (멀티모달, 선택)
- [ ] Phase 8 — 실시간 REST API 소스 (dlt rest_api) — 국제 요리에 근거 제공

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
