import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import Sky from './Sky.jsx'
import About from './About.jsx'
import Catalog from './Catalog.jsx'
import { IS_PUBLIC, LIVE_URL, loadGallery, searchLive } from './api.js'

gsap.registerPlugin(useGSAP)

const LOG = {
  parse: 'PARSING CRAVING',
  axes: 'PLOTTING SENSORY COORDINATES',
  excl: 'REMOVING EXCLUDED DISHES',
  rank: 'LOCKING FIVE DESTINATIONS',
}

const usePage = () => {
  const read = () => ({ '#about': 'about', '#catalog': 'catalog' }[location.hash] || 'search')
  const [page, setPage] = useState(read)
  useEffect(() => {
    const on = () => { setPage(read()); scrollTo(0, 0) }
    addEventListener('hashchange', on); return () => removeEventListener('hashchange', on)
  }, [])
  return page
}

export default function App() {
  const page = usePage()
  return (
    <>
      <nav className="top-nav liquid-glass mono">
        <a href="#" className="brand" aria-label="CravingRAG home"><span className="brand-mark" />CRAVINGRAG</a>
        <span className="nav-links">
          <a href="#" className="navlink" aria-current={page === 'search'}>SEARCH</a>
          <a href="#catalog" className="navlink" aria-current={page === 'catalog'}>CATALOG</a>
          <a href="#about" className="navlink" aria-current={page === 'about'}>ABOUT</a>
        </span>
      </nav>
      {page === 'about' ? <div className="about-page"><CinematicBackdrop variant="about" /><About /></div>
        : page === 'catalog' ? <div className="about-page"><CinematicBackdrop variant="about" /><Catalog /></div>
        : <Search />}
    </>
  )
}

function Search() {
  const sky = useRef(null)
  const root = useRef(null)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)         // parse | axes | excl | rank | done
  const [R, setR] = useState(null)
  const [picked, setPicked] = useState(0)
  const [err, setErr] = useState('')
  const [cuisines, setCuisines] = useState([])
  const [spice, setSpice] = useState('')
  const [rich, setRich] = useState('')
  const [avoid, setAvoid] = useState([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [gallery, setGallery] = useState([])
  const busy = stage && stage !== 'done'
  const sleep = ms => new Promise(r => setTimeout(r, ms))

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
  async function run(e, preset) {
    e?.preventDefault()
    if (busy) return
    if (IS_PUBLIC && !preset) {
      setErr(`This is the public gallery — pick a craving below. The live version takes any craving, by invite at ${LIVE_URL.replace(/^https?:\/\//, '')}`)
      return
    }
    if (preset) {
      setQ(preset.q)
      setCuisines(preset.params?.cuisines || []); setAvoid(preset.params?.avoid || [])
      setSpice(preset.params?.spice || ''); setRich(preset.params?.rich || '')
    } else if (!q.trim()) return
    setErr(''); setR(null); setPicked(0); setDetailOpen(false); sky.current?.reset()
    setStage('parse')
    let res
    if (preset) { await sleep(650); res = preset.result }   // let PARSING show; result is canned
    else {
      try { res = await searchLive(q, { cuisines, avoid, spice, rich }) }
      catch { return fail('PIPELINE OFFLINE. START ui/server.py') }
    }
    if (res.error) return fail(res.error)
    setR(res)
    setStage('axes'); await sleep(900)
    if ((res.excluded || []).length) { setStage('excl'); await sleep(900) }
    setStage('rank'); sky.current?.arrive(res.top); await sleep(300 * res.top.length + 200)
    setStage('done')
  }
  function fail(msg) { setErr(msg); setStage(null); sky.current?.reset() }
  function clear() { setStage(null); setR(null); setDetailOpen(false); sky.current?.reset() }
  function selectDish(i) { setPicked(i); setDetailOpen(true) }

  const dish = R?.top?.[picked]
  const params = [...cuisines, spice && 'spice:' + spice, rich && 'rich:' + rich, ...avoid.map(a => 'no ' + a)].filter(Boolean)

  return (
    <div ref={root} className={`search-page ${stage === 'done' ? 'search-page--results' : ''}`}>
      <CinematicBackdrop variant={stage ? 'results' : 'landing'} quiet={Boolean(stage)} />
      {stage !== 'done' && <Sky ref={sky} className={`search-sky ${stage ? 'search-sky--active' : ''}`} />}

      {/* The footage composes left; the search occupies its negative space on the right. */}
      <main className={`query ${stage === 'done' ? 'query--results' : ''}`}>
        {stage === 'done' && R ? (
          <ResultsOverview query={q} params={params} results={R} picked={picked}
            onPick={selectDish} onEdit={clear} />
        ) : <>
          <div className="eyebrow mono">
            <span className="status-dot" /> {IS_PUBLIC ? 'PRECOMPUTED GALLERY' : 'LIVE RETRIEVAL'} <span className="eyebrow-rule" /> 20,000 REAL RECIPES
          </div>
          <h1 className="hero-title">
            Search your <span className="accent">craving.</span>
          </h1>
          <p className="hero-copy">Your craving becomes a coordinate. Describe the feeling, flavor, or texture you want; we’ll navigate 20,000 real recipes and return five evidence-backed matches.{IS_PUBLIC && ' This public gallery replays real, precomputed results — the live version takes any craving, by invite.'}</p>
          <form onSubmit={run} className="search-bar liquid-glass">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="a warm spicy soup, no shellfish" aria-label="craving"
              className="query-input" />
            <button type="submit" className="search-button mono" disabled={busy}>
              <span>{busy ? 'WORKING' : 'SEARCH'}</span><span aria-hidden="true">↗</span>
            </button>
          </form>
          {err && <p className="mono" style={{ color: 'var(--accent)', marginTop: 14, fontSize: 13 }}>{err}</p>}

          {IS_PUBLIC && gallery.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#6b675f', marginBottom: 9 }}>TRY A CRAVING</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {gallery.map((g, i) => (
                  <button key={i} type="button" onClick={() => run(null, g)} disabled={busy} className="mono"
                    style={{ background: 'transparent', color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 2,
                      padding: '7px 12px', fontSize: 12, letterSpacing: '0.02em', cursor: 'pointer', textAlign: 'left' }}>
                    {g.label}
                  </button>))}
              </div>
            </div>
          )}

          {!IS_PUBLIC && <details className="filters liquid-glass">
            <summary className="mono">
              <span>FINE-TUNE YOUR SEARCH</span>
              <span className="filter-summary-meta">{params.length ? `${params.length} ACTIVE` : 'OPTIONAL'} <span className="summary-plus">+</span></span>
            </summary>
            <div className="filter-body">
              <ParamRow label="CUISINE">
                {['korean', 'thai', 'indian', 'japanese', 'chinese', 'italian', 'mexican', 'american'].map(c => (
                  <Chip key={c} on={cuisines.includes(c)} onClick={() => setCuisines(v => v.includes(c) ? v.filter(x => x !== c) : [...v, c])}>{c}</Chip>))}
              </ParamRow>
              <ParamRow label="SPICE">
                {[['', 'any'], ['none', 'none'], ['mild', 'mild'], ['medium', 'medium'], ['fire', 'fire']].map(([v, l]) => (
                  <Chip key={l} on={spice === v} onClick={() => setSpice(v)}>{l}</Chip>))}
              </ParamRow>
              <ParamRow label="RICHNESS">
                {[['', 'any'], ['light', 'light'], ['rich', 'rich & creamy']].map(([v, l]) => (
                  <Chip key={l} on={rich === v} onClick={() => setRich(v)}>{l}</Chip>))}
              </ParamRow>
              <ParamRow label="AVOID" last>
                {['shellfish', 'peanut', 'almond', 'dairy', 'cilantro', 'pork'].map(a => (
                  <Chip key={a} on={avoid.includes(a)} onClick={() => setAvoid(v => v.includes(a) ? v.filter(x => x !== a) : [...v, a])}>{a}</Chip>))}
              </ParamRow>
            </div>
          </details>}

          <div className="mono progress-log">
            {stage && <div className="progress-query">
              “{q}”{params.length > 0 && <span className="accent"> · {params.join(' / ').toUpperCase()}</span>}
            </div>}
            {busy && <div key={stage} className="stage progress-stage">
              <span className="accent">▶</span> {LOG[stage]}
              {stage === 'axes' && R && <span style={{ color: 'var(--dim)' }}>  [{R.concepts.join(' / ') || 'no axis, vector only'}]</span>}
              {stage === 'excl' && R && <span className="accent">  −{R.excluded.length} dishes</span>}
            </div>}
          </div>
          <p className="mono search-disclaimer">
            MATCHES ARE AI-EXTRACTED AND CAN BE WRONG · EXCLUSION IS A PREFERENCE FILTER, NOT ALLERGY GUIDANCE
          </p>
        </>}
      </main>

      {/* results panel */}
      {stage === 'done' && R && (
        <aside className={`panel recipe-panel ${detailOpen ? 'panel--open' : ''}`}>
          <div className="recipe-panel-header">
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 10,
              display: 'flex', justifyContent: 'space-between' }}>
              <span>RECIPE DETAIL{R.decision_id && <> · <a href={'/why?id=' + R.decision_id} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}>WHY ↗</a></>}</span>
              <button onClick={() => setDetailOpen(false)} className="panel-back mono">← RESULTS</button>
              <button onClick={clear} className="panel-new mono">NEW SEARCH</button>
            </div>
          </div>
          {dish && (
            <div key={dish.recipe_id} className="dish recipe-panel-body">
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)' }}>
                {String(picked + 1).padStart(2, '0')} · SIMILARITY {dish.sim}
              </div>
              <h3 className="recipe-title">{dish.title}</h3>
              <Sect>why it matched</Sect>
              {!dish.edges.length && <p style={{ color: 'var(--accent)', fontSize: 14 }}>
                No sensory axis covers this craving. Ranked by profile similarity alone, and logged as such.</p>}
              {dish.edges.map(e => (
                <div key={e.axis} style={{ margin: '12px 0' }}>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>{e.axis}</span>
                    <span style={{ color: 'var(--dim)' }}>{e.value} / {e.target}</span>
                  </div>
                  <div style={{ height: 4, background: '#17181c', margin: '6px 0', position: 'relative' }}>
                    <div className="bar" style={{ position: 'absolute', inset: 0, width: `${e.value * 100}%`, background: 'var(--accent)' }} />
                    <div style={{ position: 'absolute', left: `${e.target * 100}%`, top: -4, width: 1, height: 12, background: 'var(--ink)' }} />
                  </div>
                  {e.evidence.map((ev, j) => (
                    <p key={j} style={{ fontSize: 13, color: 'var(--dim)', fontStyle: 'italic', borderLeft: '2px solid var(--line)', paddingLeft: 10, margin: '3px 0' }}>“{ev}”</p>))}
                </div>))}
              {dish.ingredients?.length > 0 && <>
                <Sect>ingredients</Sect>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {dish.ingredients.map((x, j) => <span key={j} className="mono" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '4px 9px', fontSize: 11.5, color: '#b5b1a8' }}>{x}</span>)}
                </div></>}
              {dish.directions?.length > 0 && <>
                <Sect>directions</Sect>
                {dish.directions.map((x, j) => (
                  <div key={j} style={{ display: 'flex', gap: 12, margin: '9px 0', fontSize: 13.5, color: '#c2beb4' }}>
                    <span className="mono accent" style={{ fontSize: 12, flex: 'none', paddingTop: 2 }}>{String(j + 1).padStart(2, '0')}</span><span>{x}</span>
                  </div>))}</>}
              <div className="mono" style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 12, fontSize: 10.5, letterSpacing: '0.06em', color: '#6b675f', lineHeight: 1.7 }}>
                MATCHES ARE AI-EXTRACTED AND CAN BE WRONG. INGREDIENT EXCLUSION IS A PREFERENCE FILTER, NOT ALLERGY OR MEDICAL GUIDANCE.
              </div>
            </div>)}
        </aside>)}
    </div>
  )
}

function ResultsOverview({ query, params, results, picked, onPick, onEdit }) {
  return (
    <section className="results-overview">
      <div className="results-kicker mono"><span className="status-dot" /> SEARCH COMPLETE · {results.top.length} MATCHES</div>
      <div className="results-heading-row">
        <div>
          <div className="results-label mono">RECIPES FOR</div>
          <h1 className="results-query">“{query}”</h1>
        </div>
        <button type="button" onClick={onEdit} className="edit-search mono">← EDIT SEARCH</button>
      </div>
      {params.length > 0 && <div className="results-params mono">{params.join(' · ').toUpperCase()}</div>}
      <p className="results-guide">Five destinations found. Choose one to inspect why it matched, then follow the recipe in the detail panel.</p>
      <div className="ranked-results" aria-label="Ranked recipe results">
        {results.top.map((d, i) => (
          <button type="button" key={d.recipe_id} onClick={() => onPick(i)}
            className={`result-row ${picked === i ? 'result-row--active' : ''}`} aria-current={picked === i ? 'true' : undefined}>
            <span className="result-rank mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="result-main">
              <span className="result-title">{d.title}</span>
              <span className="result-reason mono">{d.edges?.length ? d.edges.slice(0, 3).map(e => e.axis).join(' · ').toUpperCase() : 'PROFILE SIMILARITY MATCH'}</span>
            </span>
            <span className="result-score mono">{d.sim}</span>
            <span className="result-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <p className="results-disclaimer mono">AI-EXTRACTED MATCHES CAN BE WRONG · EXCLUSION IS NOT ALLERGY GUIDANCE</p>
    </section>
  )
}

const BACKDROPS = {
  landing: {
    src: '/media/search-departure.mp4',
    poster: '/media/search-departure-poster.png',
    preload: 'auto',
    loop: false,
    holdAt: 7.2,
    ambientDrift: true,
  },
  results: {
    src: '/media/search-discovery.mp4',
    poster: '/media/search-discovery-poster.png',
    preload: 'auto',
    loop: false,
    twinkleTargets: true,
    starRevealAt: 4.65,
  },
  about: {
    src: '/media/about-celestial.mp4',
    poster: '/media/about-celestial-poster.png',
    playbackRate: 0.8,
    preload: 'auto',
    seamless: true,
    overlap: 1.4,
  },
}

function CinematicBackdrop({ variant = 'landing', quiet = false }) {
  const media = BACKDROPS[variant]
  return (
    <div className={`cinematic-backdrop cinematic-backdrop--${variant} ${quiet ? 'cinematic-backdrop--quiet' : ''}`} aria-hidden="true">
      {media.seamless ? <SeamlessVideo media={media} /> : (
        <AmbientHoldVideo media={media} />
      )}
      {media.twinkleTargets && <DestinationStars revealAt={media.starRevealAt} />}
      <div className="cinematic-vignette" />
      <div className="cinematic-grain" />
    </div>
  )
}

function AmbientHoldVideo({ media }) {
  const root = useRef(null)
  const video = useRef(null)

  useGSAP((_, contextSafe) => {
    const element = video.current
    const rate = media.playbackRate ?? 1
    let held = false

    const applyRate = () => {
      element.defaultPlaybackRate = rate
      element.playbackRate = rate
    }
    const holdAstronaut = contextSafe(() => {
      if (held || !media.holdAt || element.currentTime < media.holdAt) return
      held = true
      element.pause()
      element.currentTime = media.holdAt

      if (media.ambientDrift && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
          .to(element, { scale: 1.028, xPercent: 0.45, yPercent: -0.3, duration: 7.5 })
          .to(element, { scale: 1.016, xPercent: -0.2, yPercent: 0.18, duration: 6.5 })
      }
    })

    element.addEventListener('loadedmetadata', applyRate)
    element.addEventListener('timeupdate', holdAstronaut)
    applyRate()

    return () => {
      element.removeEventListener('loadedmetadata', applyRate)
      element.removeEventListener('timeupdate', holdAstronaut)
      element.pause()
    }
  }, { scope: root, dependencies: [media] })

  return (
    <div ref={root} className="cinematic-single-video">
      <video ref={video} key={media.src} autoPlay muted loop={media.loop ?? true} playsInline preload={media.preload ?? 'metadata'} poster={media.poster}>
        <source src={media.src} type="video/mp4" />
      </video>
    </div>
  )
}

const DESTINATION_POINTS = [
  [47.1, 17.8],
  [22.4, 29.7],
  [32.2, 50.3],
  [48.3, 71.3],
  [17.2, 79.0],
]

function DestinationStars({ revealAt = 4.65 }) {
  const root = useRef(null)

  useGSAP(() => {
    const stars = gsap.utils.toArray('.destination-star')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      gsap.set(stars, { autoAlpha: 0.72, scale: 1 })
      return
    }

    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .addLabel('destinations', revealAt)
      .fromTo(stars,
        { autoAlpha: 0, scale: 0.45 },
        { autoAlpha: 0.95, scale: 1, duration: 0.55, stagger: 0.08 },
        'destinations')

    stars.forEach((star, index) => {
      gsap.to(star, {
        autoAlpha: 0.32 + index * 0.055,
        scale: 0.7 + index * 0.035,
        duration: 1.15 + index * 0.23,
        delay: revealAt + 0.55 + index * 0.16,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    })
  }, { scope: root, dependencies: [revealAt], revertOnUpdate: true })

  return (
    <div ref={root} className="destination-stars">
      {DESTINATION_POINTS.map(([left, top], index) => (
        <span key={index} className="destination-star" style={{ left: `${left}%`, top: `${top}%` }} />
      ))}
    </div>
  )
}

function SeamlessVideo({ media }) {
  const root = useRef(null)
  const first = useRef(null)
  const second = useRef(null)

  useGSAP((_, contextSafe) => {
    const videos = [first.current, second.current]
    const rate = media.playbackRate ?? 1
    const overlap = media.overlap ?? 1.2
    let active = 0
    let transitioning = false
    let raf = 0
    let handoff

    const playFromStart = video => {
      video.currentTime = 0
      video.defaultPlaybackRate = rate
      video.playbackRate = rate
      video.play().catch(() => {})
    }

    const crossfade = contextSafe(() => {
      if (transitioning) return
      transitioning = true
      const outgoing = videos[active]
      const nextIndex = active === 0 ? 1 : 0
      const incoming = videos[nextIndex]
      playFromStart(incoming)

      handoff = gsap.timeline({
        defaults: { duration: overlap / rate, ease: 'none' },
        onComplete: () => {
          outgoing.pause()
          outgoing.currentTime = 0
          active = nextIndex
          transitioning = false
        },
      })
        .addLabel('handoff')
        .to(outgoing, { autoAlpha: 0 }, 'handoff')
        .to(incoming, { autoAlpha: 1 }, 'handoff')
    })

    const tick = () => {
      const current = videos[active]
      if (!transitioning && Number.isFinite(current.duration) && current.duration - current.currentTime <= overlap) {
        crossfade()
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (!videos.every(video => video.readyState >= 1)) return
      gsap.set(videos[0], { autoAlpha: 1 })
      gsap.set(videos[1], { autoAlpha: 0 })
      playFromStart(videos[0])
    }

    videos.forEach(video => video.addEventListener('loadedmetadata', start))
    start()
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      handoff?.kill()
      videos.forEach(video => {
        video.removeEventListener('loadedmetadata', start)
        video.pause()
      })
    }
  }, { scope: root })

  return (
    <div ref={root} className="cinematic-video-stack">
      <video ref={first} autoPlay muted playsInline preload="auto" poster={media.poster}>
        <source src={media.src} type="video/mp4" />
      </video>
      <video ref={second} muted playsInline preload="auto">
        <source src={media.src} type="video/mp4" />
      </video>
    </div>
  )
}

function ParamRow({ label, children, last }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: last ? 0 : 11 }}>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#6b675f', flex: 'none', width: 74 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="mono" aria-pressed={on}
      style={{ background: on ? 'var(--accent)' : 'transparent', color: on ? '#0a0a0a' : 'var(--dim)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), borderRadius: 2, padding: '5px 11px', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {children}
    </button>
  )
}

function Sect({ children }) {
  return <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--dim)', margin: '20px 0 9px', borderTop: '1px solid var(--line)', paddingTop: 13 }}>{children}</div>
}
