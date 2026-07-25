# CravingRAG — 설계 문서

> "상큼하고 과즙이 터지는 게 먹고 싶어" → 실제 레시피 추천 + 추천 이유

*English version: [DESIGN.md](DESIGN.md)*

---

## 1. 이 프로젝트가 푸는 문제

기존 레시피 검색은 **재료·요리명 키워드 매칭**이다. `WHERE ingredient IN ('chicken', 'rice')`.
하지만 사람이 실제로 먹고 싶은 걸 표현하는 방식은 그렇지 않다.

| 사용자가 실제로 하는 말 | 키워드 검색 | 필요한 것 |
|---|---|---|
| "상큼하고 과즙 터지는" | ❌ 매칭 불가 | 의미(임베딩) 검색 |
| "해장되는 뜨끈한 국물" | ❌ | 의미 검색 |
| "비 오는 날 어울리는" | ❌ | 의미 검색 |

**이 프로젝트의 존재 이유 = 감각적/감성적 쿼리는 벡터 검색으로만 풀린다.**
RAG를 배우기에 이보다 좋은 문제가 없다. 왜 임베딩이 필요한지를 몸으로 체감하게 되니까.

---

## 2. 핵심 설계 아이디어 (⭐ 가장 중요)

**나이브한 접근 (실패함):** 레시피 원문(재료 목록 + 조리법)을 그대로 임베딩한다.
→ `"2 cups flour, 1 tsp salt, bake at 350F"` 를 임베딩해봤자
   `"상큼하고 과즙 터지는"` 과 의미적으로 가깝지 않다. **검색이 안 먹힌다.**

**우리 접근 — 문서 강화(document enrichment):**
LLM으로 레시피마다 **감각 묘사(flavor profile)** 를 먼저 생성하고, **그걸** 임베딩한다.

```
원본 레시피
  title: "Citrus Summer Salad"
  ingredients: orange, grapefruit, mint, arugula, olive oil
        │
        │  ① CORTEX.COMPLETE — "맛·식감·어울리는 상황을 2문장으로"
        ▼
감각 묘사 (이게 진짜 검색 대상)
  "Bright citrus bursts with juice against crisp, peppery greens.
   Perfect for a hot summer lunch or as a palate cleanser after rich food."
        │
        │  ② AI_EMBED (다국어 모델)
        ▼
  VECTOR(FLOAT, 1024)
```

이제 `"상큼하고 과즙 터지는"` 을 임베딩하면 위 벡터와 **코사인 유사도가 높게** 나온다.

> 💡 이게 RAG에서 말하는 **"검색 가능한 형태로 문서를 다시 쓰기"** 다.
> 답변 시점이 아니라 **인덱싱 시점에 LLM을 쓴다**는 발상이 이 프로젝트의 기술적 핵심이고,
> 면접에서 설명할 포인트다.

---

## 3. 전체 데이터 흐름

```
 [HuggingFace] recipe_nlg_lite (7,198개 레시피)
        │  dlt — 증분 적재, 스키마 자동 추론, merge by uid
        ▼
 RAW.RECIPES                      ← 원본 그대로
        │  SQL + CORTEX.COMPLETE   — 감각 묘사 생성 (배치)
        ▼
 ENRICHED.RECIPE_PROFILES         ← flavor_profile 텍스트
        │  SQL + AI_EMBED          — 다국어 임베딩
        ▼
 SEARCH.RECIPE_VECTORS            ← VECTOR(FLOAT, 1024)
        │
        │  사용자 쿼리 → AI_EMBED → VECTOR_COSINE_SIMILARITY
        ▼
 Top-K 레시피 (K=10)
        │  CORTEX.COMPLETE — 재순위 + "왜 이걸 추천했는지" 설명
        ▼
 Streamlit UI
```

---

## 4. 왜 Snowflake 안에서 다 하는가

| 단계 | 보통은 | 우리는 |
|---|---|---|
| 적재 | Airbyte / 커스텀 스크립트 | **dlt** → Snowflake |
| 임베딩 | OpenAI API (유료, 키 필요) | **Snowflake AI_EMBED** |
| 벡터 DB | Pinecone / Weaviate (별도 인프라) | **VECTOR 타입** (같은 테이블) |
| 생성 | OpenAI API | **CORTEX.COMPLETE** |

→ **외부 API 키 0개, 별도 벡터 DB 0개.** 데이터가 계정 밖으로 안 나가고,
무료 트라이얼 크레딧만으로 전체 RAG 파이프라인이 돌아간다.

---

## 5. 모델 선택 (중요한 결정)

레시피는 **영어**, 쿼리는 **영어 또는 한국어**. → 반드시 **다국어(multilingual) 임베딩 모델**.
영어 전용 모델을 쓰면 한국어 쿼리가 조용히 실패한다 (디버깅하기 어려운 흔한 실수).

| 용도 | 모델 | 차원 |
|---|---|---|
| 임베딩 | `snowflake-arctic-embed-l-v2.0` | 1024, **다국어** ✅ |
| (대안) | `voyage-multilingual-2` | 1024, 다국어 |
| ❌ 쓰지 말 것 | `snowflake-arctic-embed-m-v1.5` | 768, 영어 전용 |
| 생성 | `mistral-large2` 또는 `claude-3-5-sonnet` | — |

> **크로스링구얼 검색이 되는 이유:** 다국어 모델은 여러 언어를 *하나의 벡터 공간*에 매핑한다.
> "상큼한"과 "refreshing"이 벡터 공간에서 서로 가깝다. 번역 단계 없이 한국어 쿼리로
> 영어 레시피를 검색할 수 있다는 뜻이고, 이건 보여주기 좋은 특성이자 면접 소재다.

---

## 6. 단계별 구현 계획

### Phase 1 — 파이프라인 (RAG 아직 없음)
- [ ] Snowflake 트라이얼 계정 + DB/스키마/웨어하우스 (`sql/01_setup.sql`)
- [ ] dlt로 레시피 7,198개 적재 (`pipelines/load_recipes.py`)
- [ ] `SELECT COUNT(*)` 로 확인 — **여기까지가 순수 데이터 엔지니어링**

### Phase 2 — 인덱싱 (RAG의 절반)
- [ ] CORTEX.COMPLETE로 감각 묘사 생성 (`sql/02_enrich.sql`)
  - ⚠️ 처음엔 `LIMIT 20`! 7,198개 한 번에 돌리면 크레딧 낭비
- [ ] AI_EMBED로 벡터 생성 (`sql/03_embed.sql`)

### Phase 3 — 검색 (RAG의 나머지 절반)
- [ ] 코사인 유사도 Top-K 쿼리 (`sql/04_search.sql`)
- [ ] SQL에서 직접 쿼리를 넣고 결과를 눈으로 확인
  - **이 순간이 이 프로젝트의 하이라이트.** UI 없이 SQL만으로 RAG가 도는 걸 봄

### Phase 4 — 생성 + UI
- [ ] CORTEX.COMPLETE로 근거 기반 추천 이유 생성
- [ ] Streamlit 앱 (`app/streamlit_app.py`)

### Phase 5 — 업그레이드 (이력서용 차별화)
- [ ] **Cortex Search** 로 교체 → 하이브리드 검색 (벡터 + BM25 키워드)
- [ ] 평가셋 20개 쿼리로 **Recall@5** 를 두 방식 모두 측정
- [ ] 차이를 숫자로 보고 (예: "하이브리드가 Recall@5 12% 개선")

> Phase 5의 **측정 비교**가 이 프로젝트에서 제일 강력하다.
> "RAG 만들었어요"는 흔하지만 "두 검색 방식을 측정해서 비교했어요"는 드물다.

---

## 7. 이력서 한 줄

> **CravingRAG** — Snowflake Cortex 기반 크로스링구얼 RAG 검색 파이프라인.
> dlt로 7천 건 레시피를 적재하고, LLM 문서 강화로 감각 묘사를 생성해 임베딩함으로써
> "상큼하고 과즙 터지는" 같은 감성 자연어 쿼리를 영어 레시피 코퍼스에 매칭.
> 순수 벡터 검색 대비 하이브리드 검색의 Recall@5를 벤치마크.

---

## 8. 의도적으로 안 만드는 것

PantryAI에서 이미 증명했고, 이 프로젝트의 초점을 흐리므로 **제외**:
- ❌ 유저 인증 / 소셜 기능 / meal planner
- ❌ 재고(pantry) 관리 — 별도 후속 프로젝트로

이 프로젝트는 **데이터 레이어 + 검색 품질**에만 집중한다.
