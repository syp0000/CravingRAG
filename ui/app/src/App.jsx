import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import Sky from './Sky.jsx'
import About from './About.jsx'

gsap.registerPlugin(useGSAP)

const LOG = {
  parse: 'PARSING CRAVING',
  axes: 'MAPPING SENSORY AXES',
  excl: 'REMOVING EXCLUDED DISHES',
  rank: 'RANKING',
}

const usePage = () => {
  const read = () => (location.hash === '#about' ? 'about' : 'search')
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
      <nav className="mono" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 6, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', padding: '12px 22px', fontSize: 12, letterSpacing: '0.1em',
        borderBottom: '1px solid var(--rule)', background: 'rgba(8,9,11,.85)', backdropFilter: 'blur(6px)' }}>
        <span style={{ color: 'var(--dim)' }}>CRAVINGRAG</span>
        <span style={{ display: 'flex', gap: 22 }}>
          <a href="#" className="navlink" aria-current={page === 'search'}>SEARCH</a>
          <a href="#about" className="navlink" aria-current={page === 'about'}>ABOUT</a>
        </span>
      </nav>
      {page === 'about' ? <><Sky dimmed /><About /></> : <Search />}
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
  const busy = stage && stage !== 'done'
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  // stage lines slide in one at a time; results panel and evidence bars stagger in
  useGSAP(() => {
    if (stage && stage !== 'done') gsap.fromTo('.stage', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' })
    if (stage === 'done') {
      gsap.from('.panel', { autoAlpha: 0, x: 40, duration: 0.5, ease: 'power3.out' })
      gsap.from('.panel .pick', { autoAlpha: 0, y: 8, duration: 0.35, stagger: 0.06, ease: 'power2.out', delay: 0.2 })
    }
  }, { dependencies: [stage], scope: root })
  useGSAP(() => {
    gsap.fromTo('.bar', { scaleX: 0 }, { scaleX: 1, transformOrigin: 'left center', duration: 0.6, stagger: 0.05, ease: 'power2.out' })
    gsap.from('.dish', { autoAlpha: 0, y: 6, duration: 0.3, ease: 'power2.out' })
  }, { dependencies: [picked, R], scope: root })

  async function run(e) {
    e.preventDefault()
    if (!q.trim() || busy) return
    setErr(''); setR(null); setPicked(0); sky.current?.reset()
    setStage('parse')
    const ps = new URLSearchParams({ q })
    if (cuisines.length) ps.set('cuisine', cuisines.join(','))
    if (avoid.length) ps.set('avoid', avoid.join(','))
    if (spice) ps.set('spice', spice)
    if (rich) ps.set('rich', rich)
    let res
    try { res = await fetch('/search?' + ps).then(r => r.json()) }
    catch { return fail('PIPELINE OFFLINE. START ui/server.py') }
    if (res.error) return fail(res.error)
    setR(res)
    setStage('axes'); await sleep(900)
    if ((res.excluded || []).length) { setStage('excl'); await sleep(900) }
    setStage('rank'); sky.current?.arrive(res.top); await sleep(300 * res.top.length + 200)
    setStage('done')
  }
  function fail(msg) { setErr(msg); setStage(null); sky.current?.reset() }
  function clear() { setStage(null); setR(null); sky.current?.reset() }

  const dish = R?.top?.[picked]
  const params = [...cuisines, spice && 'spice:' + spice, rich && 'rich:' + rich, ...avoid.map(a => 'no ' + a)].filter(Boolean)

  return (
    <div ref={root}>
      <Sky ref={sky} dimmed={stage === 'done'} />

      {/* query column: centred; slides left once results dock on the right */}
      <div className="query" style={{ position: 'relative', zIndex: 2, maxWidth: 640, margin: '0 auto',
        padding: stage === 'done' ? '120px 28px 60px' : '20vh 28px 60px',
        transform: stage === 'done' ? 'translateX(min(-220px, -15vw))' : 'none',
        transition: 'transform .6s cubic-bezier(.22,1,.36,1), padding .6s' }}>
        <div className="mono" style={{ fontSize: 12, letterSpacing: '0.26em', color: 'var(--dim)', marginBottom: 14 }}>
          20,000 REAL RECIPES
        </div>
        <h1 style={{ fontSize: 'clamp(40px, 6.4vw, 76px)', fontWeight: 900, lineHeight: 1.0, letterSpacing: '-0.02em',
          marginBottom: 26 }}>
          Search your <span className="accent">craving.</span>
        </h1>
        <form onSubmit={run} style={{ display: 'flex' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="a warm spicy soup, no shellfish" aria-label="craving"
            style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--line)', borderRight: 'none',
              borderRadius: '2px 0 0 2px', padding: '16px 20px', color: 'var(--ink)', fontSize: 17, outline: 'none' }} />
          <button type="submit" className="mono" disabled={busy}
            style={{ background: busy ? '#3a2a22' : 'var(--accent)', color: '#0a0a0a', border: 'none',
              borderRadius: '0 2px 2px 0', padding: '0 26px', fontWeight: 600, fontSize: 14, letterSpacing: '0.1em' }}>
            {busy ? '…' : 'SEARCH'}
          </button>
        </form>
        {err && <p className="mono" style={{ color: 'var(--accent)', marginTop: 14, fontSize: 13 }}>{err}</p>}

        <div style={{ marginTop: 22, border: '1px solid var(--line)', borderRadius: 2, padding: '16px 18px', background: 'rgba(13,14,17,.7)' }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: 'var(--dim)', marginBottom: 12 }}>OPTIONAL</div>
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

        {/* progress log */}
        <div className="mono" style={{ marginTop: 28, minHeight: 60 }}>
          {stage && (
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 8 }}>
              “{q}”{params.length > 0 && <span className="accent"> · {params.join(' / ').toUpperCase()}</span>}
            </div>)}
          {busy && (
            <div key={stage} className="stage" style={{ fontSize: 16, letterSpacing: '0.12em', color: 'var(--ink)' }}>
              <span className="accent">▶</span> {LOG[stage]}
              {stage === 'axes' && R && <span style={{ color: 'var(--dim)' }}>  [{R.concepts.join(' / ') || 'no axis, vector only'}]</span>}
              {stage === 'excl' && R && <span className="accent">  −{R.excluded.length} dishes</span>}
            </div>)}
          {stage === 'done' && R && (
            <div className="stage" style={{ fontSize: 16, letterSpacing: '0.12em' }}>
              <span className="accent">■</span> {R.top.length} RESULTS
              {R.excluded?.length > 0 && <span style={{ color: 'var(--dim)' }}> · {R.excluded.length} removed by exclusion</span>}
            </div>)}
        </div>
        <p className="mono" style={{ color: '#6b675f', fontSize: 10.5, letterSpacing: '0.06em', marginTop: 40, lineHeight: 1.8 }}>
          MATCHES ARE AI-EXTRACTED AND CAN BE WRONG · EXCLUSION IS A PREFERENCE FILTER, NOT ALLERGY GUIDANCE
        </p>
      </div>

      {/* results panel */}
      {stage === 'done' && R && (
        <aside className="panel" style={{ position: 'fixed', right: 0, top: 44, bottom: 0, width: 'min(440px, 92vw)', zIndex: 5,
          background: 'rgba(10,11,14,.94)', borderLeft: '1px solid var(--line)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', willChange: 'transform' }}>
          <div style={{ padding: '18px 22px 8px' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 10,
              display: 'flex', justifyContent: 'space-between' }}>
              <span>RESULTS · {R.top.length}{R.decision_id && <> · <a href={'/why?id=' + R.decision_id} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}>WHY ↗</a></>}</span>
              <button onClick={clear} className="mono" style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 11, letterSpacing: '0.16em' }}>✕ CLEAR</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {R.top.map((d, i) => (
                <button key={d.recipe_id} onClick={() => setPicked(i)} className="mono pick"
                  style={{ background: picked === i ? 'var(--accent)' : 'transparent', color: picked === i ? '#0a0a0a' : 'var(--dim)',
                    border: '1px solid ' + (picked === i ? 'var(--accent)' : 'var(--line)'), borderRadius: 2, padding: '6px 11px', fontSize: 12 }}>
                  {String(i + 1).padStart(2, '0')}
                </button>))}
            </div>
          </div>
          {dish && (
            <div key={dish.recipe_id} className="dish" style={{ flex: 1, overflow: 'auto', padding: '10px 22px 26px' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)' }}>
                {String(picked + 1).padStart(2, '0')} · SIMILARITY {dish.sim}
              </div>
              <h3 style={{ fontSize: 21, fontWeight: 800, textTransform: 'uppercase', margin: '6px 0 12px' }}>{dish.title}</h3>
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
