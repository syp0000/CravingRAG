import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import Sky from './Sky.jsx'
import { SingleAstronautBackdrop } from './Backdrop.jsx'
import SearchForm from './SearchForm.jsx'
import Filters from './Filters.jsx'
import ProgressLog from './ProgressLog.jsx'
import { OFFLINE_NOTICE, PUBLIC_NOTICE, describeFilters, excludedCount } from './journey.js'
import ResultsOverview from './ResultsOverview.jsx'
import RecipeDetail from './RecipeDetail.jsx'
import { IS_PUBLIC, loadGallery, searchLive } from './api.js'

gsap.registerPlugin(useGSAP)

const NO_FILTERS = { cuisines: [], spice: '', rich: '', avoid: [] }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// The search page: query state, the staged "journey" that paces the pipeline response
// against the astronaut footage, and the results / detail layout.
export default function Search() {
  const sky = useRef(null)
  const root = useRef(null)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)         // parse | axes | excl | rank | done
  const [R, setR] = useState(null)
  const [picked, setPicked] = useState(0)
  const [err, setErr] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [detailOpen, setDetailOpen] = useState(false)
  const [gallery, setGallery] = useState([])
  const dataReady = useRef(false)
  const journeyDone = useRef(false)
  const busy = stage && stage !== 'done'
  const showResults = stage === 'done' && R

  useEffect(() => { if (IS_PUBLIC) loadGallery().then(setGallery) }, [])


  // Each state has one scoped, reversible sequence so navigation stays predictable.
  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })

    if (!stage) {
      tl.addLabel('intro')
        .from('.eyebrow', { autoAlpha: 0, y: 10, duration: 0.35 }, 'intro')
        .from('.hero-title', { autoAlpha: 0, y: 24, duration: 0.72 }, 'intro+=0.08')
        .from('.hero-copy', { autoAlpha: 0, y: 14, duration: 0.5 }, 'intro+=0.24')
        .from(['.search-bar', '.filters'], { autoAlpha: 0, y: 16, duration: 0.5, stagger: 0.08 }, 'intro+=0.34')
    }
    if (stage && stage !== 'done') {
      tl.fromTo('.stage', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.35 })
    }
    if (stage === 'done') {
      tl.addLabel('results')
        .from(['.results-kicker', '.results-heading-row'], { autoAlpha: 0, y: 14, duration: 0.5, stagger: 0.08 }, 'results')
        .from('.results-guide', { autoAlpha: 0, y: 8, duration: 0.35 }, 'results+=0.18')
        .from('.result-row', { autoAlpha: 0, y: 10, duration: 0.4, stagger: 0.065 }, 'results+=0.22')
    }
  }, { dependencies: [stage], scope: root, revertOnUpdate: true })

  useGSAP(() => {
    if (!busy) return
    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .addLabel('departure')
      .to('.query-intro', { autoAlpha: 0, y: -18, duration: 0.58 }, 'departure')
      .fromTo('.journey-status', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.45 }, 'departure+=0.3')
  }, { dependencies: [busy], scope: root, revertOnUpdate: true })

  useGSAP(() => {
    if (stage !== 'done' || !R) return
    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .addLabel('detail')
      .from('.dish', { autoAlpha: 0, y: 10, duration: 0.38 }, 'detail')
      .fromTo('.bar', { scaleX: 0 }, {
        scaleX: 1,
        transformOrigin: 'left center',
        duration: 0.65,
        stagger: 0.06,
      }, 'detail+=0.12')
  }, { dependencies: [picked, R, stage], scope: root, revertOnUpdate: true })

  // preset = a precomputed gallery entry {q, params, result}; absent = live free-text.

  function resetJourney() { dataReady.current = false; journeyDone.current = false; sky.current?.reset() }

  // preset = a precomputed gallery entry {q, params, result}; absent = live free-text.
  async function run(e, preset) {
    e?.preventDefault()
    if (busy) return
    if (IS_PUBLIC && !preset) { setErr(PUBLIC_NOTICE); return }
    if (preset) {
      setQ(preset.q)
      setFilters({ ...NO_FILTERS, ...preset.params, spice: preset.params?.spice || '', rich: preset.params?.rich || '' })
    } else if (!q.trim()) return
    setErr(''); setR(null); setPicked(0); setDetailOpen(false); resetJourney()
    setStage('parse')
    let res
    if (preset) { await sleep(650); res = preset.result }   // let PARSING show; result is canned
    else {
      try { res = await searchLive(q, filters) }
      catch { return fail(OFFLINE_NOTICE) }
    }
    if (res.error) return fail(res.error)
    setR(res)
    setStage('axes'); await sleep(900)
    if (excludedCount(res) > 0) { setStage('excl'); await sleep(900) }
    setStage('rank'); await sleep(300 * res.top.length + 200)
    dataReady.current = true
    if (journeyDone.current) setStage('done')
  }
  function finishJourney() { journeyDone.current = true; if (dataReady.current) setStage('done') }
  function fail(msg) { setErr(msg); setStage(null); resetJourney() }
  function clear() { setStage(null); setR(null); setDetailOpen(false); resetJourney() }
  function selectDish(i) { setPicked(i); setDetailOpen(true) }

  const dish = R?.top?.[picked]
  const params = describeFilters(filters)

  return (
    <div ref={root} className={`search-page ${stage === 'done' ? 'search-page--results' : ''}`}>
      <SingleAstronautBackdrop departing={Boolean(stage)} resultsVisible={stage === 'done'} onComplete={finishJourney} />
      <Sky ref={sky} className="search-sky" />

      {/* The footage composes left; the search occupies its negative space on the right. */}
      <main className={`query ${stage === 'done' ? 'query--results' : ''}`}>
        {showResults ? (
          <ResultsOverview query={q} params={params} results={R} picked={picked}
            onPick={selectDish} onEdit={clear} />
        ) : <>
          <div className="query-intro">
          <div className="eyebrow mono">
            <span className="status-dot" /> {IS_PUBLIC ? 'PRECOMPUTED GALLERY' : 'LIVE RETRIEVAL'} <span className="eyebrow-rule" /> 20,000 REAL RECIPES
          </div>
          <h1 className="hero-title">
            Search your <span className="accent">craving.</span>
          </h1>
          <p className="hero-copy">Your craving becomes a coordinate. Describe the feeling, flavor, or texture you want; we’ll navigate 20,000 real recipes and return up to five evidence-backed matches.{IS_PUBLIC && ' This public gallery replays real, precomputed results — the live version takes any craving, by invite.'}</p>
          <SearchForm query={q} onQueryChange={setQ} onSubmit={run} busy={busy} error={err}
            gallery={gallery} onPickPreset={g => run(null, g)} />
          {!IS_PUBLIC && <Filters filters={filters} onChange={setFilters} activeCount={params.length} />}
          <p className="mono search-disclaimer">
            MATCHES ARE AI-EXTRACTED AND CAN BE WRONG · EXCLUSION IS A PREFERENCE FILTER, NOT ALLERGY GUIDANCE
          </p>
          </div>
          <ProgressLog stage={stage} busy={busy} query={q} params={params} result={R} />
        </>}
      </main>

      {/* results panel — never an empty shell when nothing survived the quality layer */}
      {showResults && R.top.length > 0 && (
        <RecipeDetail dish={dish} index={picked} decisionId={R.decision_id} open={detailOpen}
          onBack={() => setDetailOpen(false)} onNewSearch={clear} />)}
    </div>
  )
}
