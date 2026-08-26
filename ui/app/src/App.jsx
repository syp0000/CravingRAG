import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useScroll, useTransform, useSpring, useMotionValueEvent } from 'framer-motion'
import Sky from './Sky.jsx'

const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-12%' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
}

const LOG = {
  warp: 'UNDERWAY · PARSING CRAVING SIGNAL',
  axes: 'PLOTTING SENSORY AXES',
  excl: 'JETTISONING EXCLUDED CARGO',
  rank: 'DECELERATING · FINAL APPROACH',
}

const PHASES = [
  ['01', 'CARTOGRAPHY', 'Every dish is a star.',
    'Cortex reads each unstructured recipe and charts its sensory coordinates: spicy 0.8, brothy 1.0. The exact ingredient lines are kept as evidence. No evidence, no coordinate.'],
  ['02', 'SIGNAL', 'Say it like you feel it.',
    '“warm spicy soup, no shellfish” is not a keyword list. A live parser turns craving language into concepts, axes, and hard exclusions.'],
  ['03', 'JETTISON', 'No means no.',
    'Embeddings cannot subtract. An anti-join can. Dishes carrying what you excluded are cut loose before ranking ever sees them. Measured: exclusion quality 0.245 to 0.855.'],
]

// blueprint-style probe, faces right; flame flickers
function Ship({ style }) {
  return (
    <motion.div style={{ position: 'fixed', zIndex: 3, pointerEvents: 'none', ...style }}
      animate={{ y: [0, -9, 0] }} transition={{ repeat: Infinity, duration: 3.4, ease: 'easeInOut' }}>
      <svg width="112" height="52" viewBox="0 0 112 52" fill="none">
        <motion.g animate={{ opacity: [1, 0.4, 1], scaleX: [1, 0.75, 1] }}
          transition={{ repeat: Infinity, duration: 0.5 }} style={{ originX: '26px', originY: '26px' }}>
          <path d="M26 22 L6 26 L26 30 Z" fill="#ff4f00" />
          <path d="M24 24 L14 26 L24 28 Z" fill="#ffb08a" />
        </motion.g>
        <g stroke="#ece9e2" strokeWidth="1.6" fill="none">
          <path d="M28 18 H64 Q84 18 96 26 Q84 34 64 34 H28 Q24 34 24 30 V22 Q24 18 28 18 Z" />
          <circle cx="78" cy="26" r="4.5" />
          <path d="M40 18 V10 H52 V18" />
          <path d="M40 34 V42 H52 V34" />
          <path d="M96 26 H106" strokeDasharray="2 4" />
        </g>
        <circle cx="78" cy="26" r="1.8" fill="#ff4f00" />
      </svg>
    </motion.div>
  )
}

export default function App() {
  const sky = useRef(null)
  const { scrollY } = useScroll()
  const parallax = useSpring(useTransform(scrollY, [0, 2400], [0, -260]), { stiffness: 60, damping: 20 })
  const heroFade = useTransform(scrollY, [0, 500], [1, 0])
  const [view, setView] = useState('landing')      // landing | voyage
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)         // warp | axes | excl | rank | done
  const [R, setR] = useState(null)
  const [picked, setPicked] = useState(0)
  const [err, setErr] = useState('')
  const [alt, setAlt] = useState(0)
  const [shipPos, setShipPos] = useState({ left: '12vw', top: '46vh' })
  useMotionValueEvent(scrollY, 'change', v => setAlt(Math.round(v / 8)))
  useEffect(() => { document.body.style.overflow = view === 'voyage' ? 'hidden' : '' }, [view])

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  async function launch(e) {
    e.preventDefault()
    if (!q.trim() || (stage && stage !== 'done')) return
    setErr(''); setR(null); setPicked(0)
    sky.current?.reset()
    setView('voyage'); setShipPos({ left: '12vw', top: '46vh' })
    setStage('warp'); sky.current?.warp()
    let res
    try { res = await (await fetch('/search?q=' + encodeURIComponent(q))).json() }
    catch { abort('PIPELINE OFFLINE. START ui/server.py'); return }
    if (res.error) { abort(res.error); return }
    setR(res)
    await sleep(1400)
    setStage('axes'); sky.current?.cruise(); await sleep(1500)
    if ((res.excluded || []).length) {
      setStage('excl'); sky.current?.jettison(res.excluded); await sleep(2800)
    }
    setStage('rank')
    sky.current?.arrive(res.top)
    await sleep(350 * res.top.length + 1500)
    setStage('done')
  }
  function abort(msg) { setErr(msg); setStage(null); setView('landing'); sky.current?.reset() }
  function returnToBrief() { setStage(null); setR(null); sky.current?.reset(); setView('landing') }
  function pick(i) {
    setPicked(i)
    const pts = sky.current?.contactPoints() || []
    const p = pts.find(c => c.rank === i)
    if (p) setShipPos({ left: `calc(${(p.x * 100).toFixed(1)}vw - 150px)`, top: `calc(${(p.y * 100).toFixed(1)}vh - 26px)` })
  }

  const dish = R?.top?.[picked]

  return (
    <>
      <Sky ref={sky} parallax={parallax} />

      {/* HUD */}
      <div className="mono" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 6,
        display: 'flex', justifyContent: 'space-between', padding: '12px 20px',
        fontSize: 11, letterSpacing: '0.08em', color: 'var(--dim)',
        borderBottom: '1px solid var(--rule)', background: 'rgba(8,9,11,.82)', backdropFilter: 'blur(6px)' }}>
        <span>CRAVINGRAG · DEEP-CATALOG SURVEY</span>
        <span>
          CAT <span style={{ color: 'var(--ink)' }}>20,000</span>
          {view === 'landing'
            ? <> · ALT <span style={{ color: 'var(--ink)' }}>{String(alt).padStart(3, '0')}</span></>
            : <> · MODE <span style={{ color: 'var(--ink)' }}>{(stage || 'IDLE').toUpperCase()}</span></>}
          {' '}· SYS <span className="accent">NOMINAL</span>
        </span>
      </div>

      <AnimatePresence mode="wait">
        {view === 'landing' ? (
          /* ─────────────── LANDING ─────────────── */
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}>
            <motion.section style={{ opacity: heroFade }}>
              <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 22, position: 'relative', zIndex: 2,
                padding: '0 24px', textAlign: 'center' }}>
                <div className="mono" style={{ fontSize: 12, letterSpacing: '0.28em', color: 'var(--dim)' }}>
                  MISSION BRIEF · 386 HUMAN JUDGMENTS ON RECORD
                </div>
                <h1 style={{ fontSize: 'clamp(52px, 8.5vw, 118px)', fontWeight: 900, lineHeight: 0.98,
                  letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                  Twenty thousand stars.<br />
                  <span className="accent">Five are dinner.</span>
                </h1>
                <p style={{ fontSize: 'clamp(16px, 1.8vw, 20px)', color: 'var(--dim)', maxWidth: 540 }}>
                  Real recipes, charted by how they taste. Say what you crave, then fly out and find it.
                </p>
                <div className="mono" style={{ position: 'absolute', bottom: 30, fontSize: 11,
                  letterSpacing: '0.3em', color: 'var(--dim)' }}>▼ BEGIN DESCENT</div>
              </div>
            </motion.section>

            <section style={{ position: 'relative', zIndex: 2 }}>
              {PHASES.map(([num, code, h, p], i) => (
                <motion.div key={i} {...fadeUp}
                  style={{ minHeight: '68vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    maxWidth: 780, margin: '0 auto', padding: '0 32px' }}>
                  <div className="mono" style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    PHASE {num} <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> {code}
                  </div>
                  <h2 style={{ fontSize: 'clamp(34px, 4.6vw, 58px)', fontWeight: 800,
                    textTransform: 'uppercase', marginBottom: 16 }}>{h}</h2>
                  <p style={{ fontSize: 'clamp(15px, 1.5vw, 19px)', color: 'var(--dim)', maxWidth: 580 }}>{p}</p>
                </motion.div>
              ))}
            </section>

            <section style={{ position: 'relative', zIndex: 2, minHeight: '70vh', padding: '8vh 32px 16vh' }}>
              <motion.div {...fadeUp} className="mono" style={{ maxWidth: 680, margin: '0 auto 14px',
                fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', gap: 14 }}>
                PHASE 04 <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> DEPARTURE
              </motion.div>
              <motion.form onSubmit={launch} {...fadeUp}
                style={{ display: 'flex', gap: 0, maxWidth: 680, margin: '0 auto' }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="a warm spicy soup, no shellfish"
                  style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--line)', borderRight: 'none',
                    borderRadius: '2px 0 0 2px', padding: '17px 22px', color: 'var(--ink)', fontSize: 17, outline: 'none' }} />
                <button type="submit" className="mono"
                  style={{ background: 'var(--accent)', color: '#0a0a0a', border: 'none',
                    borderRadius: '0 2px 2px 0', padding: '0 28px', fontWeight: 600, fontSize: 14, letterSpacing: '0.1em' }}>
                  LAUNCH
                </button>
              </motion.form>
              {err && <p className="mono" style={{ textAlign: 'center', color: 'var(--accent)', marginTop: 16, fontSize: 13 }}>{err}</p>}

              <motion.div {...fadeUp} className="mono" style={{ maxWidth: 1000, margin: '18vh auto 14px',
                fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', gap: 14 }}>
                FLIGHT RECORD <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> MEASURED, NOT CLAIMED
              </motion.div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 1, maxWidth: 1000, margin: '0 auto', background: 'var(--line)', border: '1px solid var(--line)' }}>
                {[
                  ['0.844', 'NDCG@5', 'enriched vectors + hard exclusion, the measured winner of four arms'],
                  ['3.5×', 'EXCLUSION', 'quality vs baseline, 0.245 to 0.855. embeddings cannot subtract'],
                  ['21 MIN', '20K ENRICHED', 'full corpus for ≈$90, meter read before a dollar was spent'],
                  ['386', 'JUDGMENTS', 'blinded human grades behind every number on this page'],
                ].map(([n, k, d], i) => (
                  <motion.div key={i} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.08 }}
                    style={{ background: 'var(--bg)', padding: '28px 24px' }}>
                    <div style={{ fontFamily: 'Archivo', fontSize: 40, fontWeight: 900 }}>{n}</div>
                    <div className="mono accent" style={{ fontSize: 11, letterSpacing: '0.2em', margin: '6px 0 8px' }}>{k}</div>
                    <p style={{ color: 'var(--dim)', fontSize: 13.5 }}>{d}</p>
                  </motion.div>
                ))}
              </div>
              <p className="mono" style={{ textAlign: 'center', color: '#6b675f', fontSize: 10.5,
                letterSpacing: '0.06em', marginTop: 40, lineHeight: 1.8 }}>
                RECOMMENDATIONS ARE AI-EXTRACTED AND CAN MISS YOUR CRAVING · EXCLUSION IS A PREFERENCE
                FILTER, NOT ALLERGY GUIDANCE · LIMITS ON RECORD IN PLAN.MD §V3
              </p>
            </section>
          </motion.div>
        ) : (
          /* ─────────────── VOYAGE ─────────────── */
          <motion.div key="voyage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ position: 'fixed', inset: 0, zIndex: 2 }}>

            <motion.div initial={false} animate={shipPos} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ position: 'fixed', zIndex: 3 }}>
              <Ship style={{ position: 'static' }} />
            </motion.div>

            <button onClick={returnToBrief} className="mono"
              style={{ position: 'fixed', top: 52, right: 20, zIndex: 7, background: 'transparent',
                border: '1px solid var(--line)', borderRadius: 2, color: 'var(--dim)',
                padding: '8px 14px', fontSize: 11, letterSpacing: '0.16em' }}>
              ← RETURN TO BRIEF
            </button>

            {/* mission log */}
            <div style={{ position: 'fixed', left: 24, bottom: 24, zIndex: 4, maxWidth: '46vw' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 8 }}>
                MISSION LOG · “{q}”
              </div>
              <AnimatePresence mode="wait">
                {stage && stage !== 'done' && (
                  <motion.div key={stage} className="mono"
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.3 }}
                    style={{ fontSize: 'clamp(15px, 1.8vw, 20px)', letterSpacing: '0.12em', color: 'var(--ink)' }}>
                    <span className="accent">▶</span> {LOG[stage]}
                    {stage === 'axes' && R && <span style={{ color: 'var(--dim)' }}>  [{R.concepts.join(' / ')}]</span>}
                    {stage === 'excl' && R && <span className="accent">  −{R.excluded.length}</span>}
                  </motion.div>
                )}
                {stage === 'done' && R && (
                  <motion.div key="arrived" className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    style={{ fontSize: 'clamp(15px, 1.8vw, 20px)', letterSpacing: '0.12em' }}>
                    <span className="accent">■</span> {R.top.length} CONTACTS ACQUIRED · SELECT TO APPROACH
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* contacts rail + manual */}
            <AnimatePresence>
              {stage === 'done' && R && (
                <motion.div initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  style={{ position: 'fixed', right: 0, top: 40, bottom: 0, width: 'min(420px, 92vw)', zIndex: 5,
                    background: 'rgba(10,11,14,.94)', borderLeft: '1px solid var(--line)',
                    backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '18px 22px 8px' }}>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 10 }}>
                      CONTACTS · {R.top.length}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {R.top.map((d, i) => (
                        <button key={d.recipe_id} onClick={() => pick(i)} className="mono"
                          style={{ background: picked === i ? 'var(--accent)' : 'transparent',
                            color: picked === i ? '#0a0a0a' : 'var(--dim)',
                            border: '1px solid ' + (picked === i ? 'var(--accent)' : 'var(--line)'),
                            borderRadius: 2, padding: '6px 11px', fontSize: 12, letterSpacing: '0.08em' }}>
                          {String(i + 1).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </div>
                  {dish && (
                    <div key={dish.recipe_id} style={{ flex: 1, overflow: 'auto', padding: '10px 22px 26px' }}>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)' }}>
                        CONTACT {String(picked + 1).padStart(2, '0')} · MATCH {dish.sim}
                      </div>
                      <h3 style={{ fontSize: 21, fontWeight: 800, textTransform: 'uppercase', margin: '6px 0 12px' }}>
                        {dish.title}
                      </h3>
                      <Sect>why it matched</Sect>
                      {!dish.edges.length && (
                        <p style={{ color: 'var(--accent)', fontSize: 14 }}>
                          No sensory axis covers this craving. Ranked by profile similarity alone, and logged as such.
                        </p>
                      )}
                      {dish.edges.map(e => (
                        <div key={e.axis} style={{ margin: '12px 0' }}>
                          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <span style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>{e.axis}</span>
                            <span style={{ color: 'var(--dim)' }}>{e.value} / {e.target}</span>
                          </div>
                          <div style={{ height: 4, background: '#17181c', margin: '6px 0', position: 'relative' }}>
                            <motion.div initial={{ width: 0 }} animate={{ width: `${e.value * 100}%` }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                              style={{ position: 'absolute', inset: '0 auto 0 0', background: 'var(--accent)' }} />
                            <div style={{ position: 'absolute', left: `${e.target * 100}%`, top: -4, width: 1, height: 12, background: 'var(--ink)' }} />
                          </div>
                          {e.evidence.map((ev, j) => (
                            <p key={j} style={{ fontSize: 13, color: 'var(--dim)', fontStyle: 'italic',
                              borderLeft: '2px solid var(--line)', paddingLeft: 10, margin: '3px 0' }}>“{ev}”</p>
                          ))}
                        </div>
                      ))}
                      {dish.ingredients?.length > 0 && (<>
                        <Sect>manifest · ingredients</Sect>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {dish.ingredients.map((x, j) => (
                            <span key={j} className="mono" style={{ border: '1px solid var(--line)', borderRadius: 2,
                              padding: '4px 9px', fontSize: 11.5, color: '#b5b1a8' }}>{x}</span>
                          ))}
                        </div>
                      </>)}
                      {dish.directions?.length > 0 && (<>
                        <Sect>procedure</Sect>
                        {dish.directions.map((x, j) => (
                          <div key={j} style={{ display: 'flex', gap: 12, margin: '9px 0', fontSize: 13.5, color: '#c2beb4' }}>
                            <span className="mono accent" style={{ fontSize: 12, flex: 'none', paddingTop: 2 }}>
                              {String(j + 1).padStart(2, '0')}
                            </span>
                            <span>{x}</span>
                          </div>
                        ))}
                      </>)}
                      <div className="mono" style={{ marginTop: 22, borderTop: '1px solid var(--line)',
                        paddingTop: 12, fontSize: 10.5, letterSpacing: '0.06em', color: '#6b675f', lineHeight: 1.7 }}>
                        ADVISORY: MATCHES ARE AI-EXTRACTED AND CAN BE WRONG. INGREDIENT EXCLUSION IS A
                        PREFERENCE FILTER, NOT ALLERGY OR MEDICAL GUIDANCE. READ THE RECIPE YOURSELF.
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function Sect({ children }) {
  return <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
    color: 'var(--dim)', margin: '20px 0 9px', borderTop: '1px solid var(--line)', paddingTop: 13 }}>
    {children}
  </div>
}
