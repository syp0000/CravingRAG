import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useScroll, useTransform, useSpring, useMotionValueEvent } from 'framer-motion'
import Sky from './Sky.jsx'

const fadeUp = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-12%' },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
}

const STAGES = {
  parse: 'PARSING CRAVING SIGNAL',
  axes: 'MAPPING TO SENSORY AXES',
  excl: 'JETTISONING EXCLUDED CARGO',
  rank: 'PLOTTING FINAL APPROACH',
}

const PHASES = [
  ['01', 'CARTOGRAPHY', 'Every dish is a star.',
    'Cortex reads each unstructured recipe and charts its sensory coordinates — spicy 0.8, brothy 1.0 — with the exact ingredient lines kept as evidence. No evidence, no coordinate.'],
  ['02', 'SIGNAL', 'Say it like you feel it.',
    '“warm spicy soup, no shellfish” is not a keyword list. A live parser turns craving language into concepts, axes, and hard exclusions.'],
  ['03', 'JETTISON', 'No means no.',
    'Embeddings cannot subtract — an anti-join can. Dishes carrying what you excluded are cut loose before ranking ever sees them. Measured: exclusion quality 0.245 → 0.855.'],
]

export default function App() {
  const sky = useRef(null)
  const { scrollY } = useScroll()
  const parallax = useSpring(useTransform(scrollY, [0, 2400], [0, -260]), { stiffness: 60, damping: 20 })
  const heroFade = useTransform(scrollY, [0, 500], [1, 0])
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)
  const [R, setR] = useState(null)
  const [picked, setPicked] = useState(0)
  const [err, setErr] = useState('')
  const [alt, setAlt] = useState(0)
  useMotionValueEvent(scrollY, 'change', v => setAlt(Math.round(v / 8)))

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function run(e) {
    e.preventDefault()
    if (!q.trim() || (stage && stage !== 'done')) return
    setErr(''); setR(null); sky.current?.reset()
    setStage('parse')
    let res
    try { res = await (await fetch('/search?q=' + encodeURIComponent(q))).json() }
    catch { setErr('PIPELINE OFFLINE — start ui/server.py'); setStage(null); return }
    if (res.error) { setErr(res.error); setStage(null); return }
    setR(res)
    await sleep(1100)
    setStage('axes'); await sleep(1300)
    if ((res.excluded || []).length) {
      setStage('excl'); sky.current?.kill(res.excluded); await sleep(2600)
    }
    setStage('rank'); sky.current?.dimRest(); await sleep(500)
    sky.current?.constellation(res.top)
    await sleep(1600)
    setStage('done'); setPicked(0)
  }

  const dish = R?.top?.[picked]

  return (
    <>
      <Sky ref={sky} parallax={parallax} />

      {/* instrument strip — the astronaut's HUD */}
      <div className="mono" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 6,
        display: 'flex', justifyContent: 'space-between', padding: '12px 20px',
        fontSize: 11, letterSpacing: '0.08em', color: 'var(--dim)',
        borderBottom: '1px solid var(--rule)', background: 'rgba(8,9,11,.82)', backdropFilter: 'blur(6px)' }}>
        <span>CRAVINGRAG · DEEP-CATALOG SURVEY</span>
        <span>CAT <span style={{ color: 'var(--ink)' }}>20,000</span> · ALT <span style={{ color: 'var(--ink)' }}>{String(alt).padStart(3, '0')}</span> · SYS <span className="accent">NOMINAL</span></span>
      </div>

      {/* ── hero ── */}
      <motion.section style={{ opacity: heroFade }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 22, position: 'relative', zIndex: 2,
          padding: '0 24px', textAlign: 'center' }}>
          <motion.div className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            style={{ fontSize: 12, letterSpacing: '0.28em', color: 'var(--dim)' }}>
            MISSION BRIEF — 386 HUMAN JUDGMENTS ON RECORD
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 34 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: 'clamp(52px, 8.5vw, 118px)', fontWeight: 900, lineHeight: 0.98,
              letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
            Twenty thousand stars.<br />
            <span className="accent">Five are dinner.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.9 }}
            style={{ fontSize: 'clamp(16px, 1.8vw, 20px)', color: 'var(--dim)', maxWidth: 540 }}>
            Real recipes, charted by how they taste. Say what you crave — the survey plots the course.
          </motion.p>
          <motion.div className="mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
            style={{ position: 'absolute', bottom: 30, fontSize: 11, letterSpacing: '0.3em', color: 'var(--dim)' }}>
            ▼ BEGIN DESCENT
          </motion.div>
        </div>
      </motion.section>

      {/* ── mission phases ── */}
      <section style={{ position: 'relative', zIndex: 2 }}>
        {PHASES.map(([num, code, h, p], i) => (
          <motion.div key={i} {...fadeUp}
            style={{ minHeight: '72vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
              maxWidth: 780, margin: '0 auto', padding: '0 32px' }}>
            <div className="mono" style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              PHASE {num} <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> {code}
            </div>
            <h2 style={{ fontSize: 'clamp(34px, 4.6vw, 58px)', fontWeight: 800, letterSpacing: '-0.01em',
              textTransform: 'uppercase', marginBottom: 16 }}>{h}</h2>
            <p style={{ fontSize: 'clamp(15px, 1.5vw, 19px)', color: 'var(--dim)', maxWidth: 580 }}>{p}</p>
          </motion.div>
        ))}
      </section>

      {/* ── live search ── */}
      <section style={{ position: 'relative', zIndex: 2, minHeight: '100vh', padding: '10vh 32px 8vh' }}>
        <motion.div {...fadeUp} className="mono" style={{ maxWidth: 680, margin: '0 auto 14px',
          fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 14 }}>
          PHASE 04 <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> LIVE SURVEY
        </motion.div>
        <motion.form onSubmit={run} {...fadeUp}
          style={{ display: 'flex', gap: 0, maxWidth: 680, margin: '0 auto' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="a warm spicy soup, no shellfish"
            style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--line)', borderRight: 'none',
              borderRadius: '2px 0 0 2px', padding: '17px 22px', color: 'var(--ink)', fontSize: 17, outline: 'none' }} />
          <button type="submit" className="mono"
            style={{ background: 'var(--accent)', color: '#0a0a0a', border: 'none', borderRadius: '0 2px 2px 0',
              padding: '0 28px', fontWeight: 600, fontSize: 14, letterSpacing: '0.1em' }}>
            LAUNCH
          </button>
        </motion.form>
        {err && <p className="mono" style={{ textAlign: 'center', color: 'var(--accent)', marginTop: 16, fontSize: 13 }}>{err}</p>}

        {/* mission log */}
        <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            {stage && stage !== 'done' && (
              <motion.div key={stage} className="mono"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.35 }}
                style={{ fontSize: 'clamp(14px, 1.9vw, 19px)', letterSpacing: '0.14em', color: 'var(--ink)' }}>
                <span className="accent">▶</span> {STAGES[stage]}
                {stage === 'axes' && R && <span style={{ color: 'var(--dim)' }}>  [{R.concepts.join(' / ')}]</span>}
                {stage === 'excl' && R && <span className="accent">  −{R.excluded.length}</span>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* results — flight manual */}
        <AnimatePresence>
          {stage === 'done' && R && (
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: 'flex', gap: 24, maxWidth: 1060, margin: '4vh auto 0', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column' }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)',
                  padding: '0 0 10px 2px' }}>CONTACTS — {R.top.length}</div>
                {R.top.map((d, i) => (
                  <motion.button key={d.recipe_id} onClick={() => setPicked(i)}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                    style={{ textAlign: 'left', background: picked === i ? 'var(--card)' : 'transparent',
                      border: 'none', borderLeft: picked === i ? '2px solid var(--accent)' : '2px solid var(--line)',
                      padding: '13px 16px', color: 'var(--ink)', display: 'flex', gap: 14, alignItems: 'baseline' }}>
                    <span className="mono accent" style={{ fontSize: 13 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontWeight: 600, fontSize: 15.5 }}>{d.title}</span>
                  </motion.button>
                ))}
              </div>
              {dish && (
                <motion.div key={dish.recipe_id}
                  initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
                  style={{ flex: '2 1 420px', background: 'var(--card)', border: '1px solid var(--line)',
                    borderRadius: 2, padding: '26px 28px', maxHeight: '74vh', overflow: 'auto' }}>
                  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)' }}>
                    CONTACT {String(picked + 1).padStart(2, '0')} · MATCH {dish.sim}
                  </div>
                  <h3 style={{ fontSize: 23, fontWeight: 800, textTransform: 'uppercase', margin: '6px 0 4px' }}>{dish.title}</h3>
                  <p style={{ color: 'var(--dim)', fontSize: 14, marginBottom: 6 }}>“{R.query}”</p>

                  <Sect>why it matched</Sect>
                  {!dish.edges.length && (
                    <p style={{ color: 'var(--accent)', fontSize: 14.5 }}>
                      No sensory axis covers this craving — ranked by profile similarity alone, and logged as such.
                    </p>
                  )}
                  {dish.edges.map(e => (
                    <div key={e.axis} style={{ margin: '13px 0' }}>
                      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                        <span style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>{e.axis}</span>
                        <span style={{ color: 'var(--dim)' }}>{e.value} / {e.target}</span>
                      </div>
                      <div style={{ height: 4, background: '#17181c', margin: '7px 0', position: 'relative' }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${e.value * 100}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          style={{ position: 'absolute', inset: '0 auto 0 0', background: 'var(--accent)' }} />
                        <div style={{ position: 'absolute', left: `${e.target * 100}%`, top: -4, width: 1, height: 12, background: 'var(--ink)' }} />
                      </div>
                      {e.evidence.map((ev, j) => (
                        <p key={j} style={{ fontSize: 13.5, color: 'var(--dim)', fontStyle: 'italic',
                          borderLeft: '2px solid var(--line)', paddingLeft: 10, margin: '4px 0' }}>“{ev}”</p>
                      ))}
                    </div>
                  ))}

                  {dish.ingredients?.length > 0 && (<>
                    <Sect>manifest — ingredients</Sect>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {dish.ingredients.map((x, j) => (
                        <span key={j} className="mono" style={{ border: '1px solid var(--line)', borderRadius: 2,
                          padding: '5px 10px', fontSize: 12, color: '#b5b1a8' }}>{x}</span>
                      ))}
                    </div>
                  </>)}

                  {dish.directions?.length > 0 && (<>
                    <Sect>procedure</Sect>
                    {dish.directions.map((x, j) => (
                      <div key={j} style={{ display: 'flex', gap: 14, margin: '10px 0', fontSize: 14.5, color: '#c2beb4' }}>
                        <span className="mono accent" style={{ fontSize: 12.5, flex: 'none', paddingTop: 2 }}>
                          {String(j + 1).padStart(2, '0')}
                        </span>
                        <span>{x}</span>
                      </div>
                    ))}
                  </>)}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ── flight record ── */}
      <section style={{ position: 'relative', zIndex: 2, padding: '14vh 32px',
        background: 'linear-gradient(180deg, transparent, rgba(8,9,11,.94) 26%)' }}>
        <motion.div {...fadeUp} className="mono" style={{ maxWidth: 1000, margin: '0 auto 14px',
          fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 14 }}>
          FLIGHT RECORD <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /> MEASURED, NOT CLAIMED
        </motion.div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 1, maxWidth: 1000, margin: '0 auto', background: 'var(--line)', border: '1px solid var(--line)' }}>
          {[
            ['0.844', 'NDCG@5', 'enriched vectors + hard exclusion — measured winner of four arms'],
            ['3.5×', 'EXCLUSION', 'quality vs baseline, 0.245 → 0.855 — embeddings cannot subtract'],
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
        <motion.p {...fadeUp} className="mono" style={{ textAlign: 'center', color: 'var(--dim)',
          fontSize: 12, letterSpacing: '0.08em', marginTop: 50 }}>
          A RETRIEVAL STUDY WITH AN EXPLANATION LAYER · SNOWFLAKE CORTEX END TO END · LIMITS ON RECORD: PLAN.MD §V3
        </motion.p>
      </section>
    </>
  )
}

function Sect({ children }) {
  return <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
    color: 'var(--dim)', margin: '22px 0 10px', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
    {children}
  </div>
}
