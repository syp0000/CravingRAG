import { useRef, useState } from 'react'
import { AnimatePresence, motion, useScroll, useTransform, useSpring, useInView } from 'framer-motion'
import Sky from './Sky.jsx'

const fadeUp = {
  initial: { opacity: 0, y: 60 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-15%' },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
}

function Counter({ to, decimals = 0, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-20%' })
  return (
    <span ref={ref}>
      {inView ? (
        <motion.span
          initial={{ '--n': 0 }}
          animate={{ '--n': to }}
          transition={{ duration: 1.6, ease: 'easeOut' }}
        >
          <Tween to={to} decimals={decimals} suffix={suffix} />
        </motion.span>
      ) : '0' + suffix}
    </span>
  )
}
function Tween({ to, decimals, suffix }) {
  const [v, setV] = useState(0)
  useRef((() => {
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 1600)
      setV(to * (1 - Math.pow(1 - p, 3)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()).current
  return <>{v.toFixed(decimals)}{suffix}</>
}

const STAGES = {
  parse: 'Understanding your craving',
  axes: 'Mapping it to sensory axes',
  excl: 'Removing what you said no to',
  rank: 'Choosing five from the sky',
}

export default function App() {
  const sky = useRef(null)
  const { scrollY } = useScroll()
  const parallax = useSpring(useTransform(scrollY, [0, 2400], [0, -260]), { stiffness: 60, damping: 20 })
  const heroFade = useTransform(scrollY, [0, 500], [1, 0])
  const heroScale = useTransform(scrollY, [0, 500], [1, 0.94])
  const [q, setQ] = useState('')
  const [stage, setStage] = useState(null)     // null | parse | axes | excl | rank | done
  const [R, setR] = useState(null)
  const [picked, setPicked] = useState(0)
  const [err, setErr] = useState('')
  const searchRef = useRef(null)
  // no scroll hijacking: the user is already at the form, the sky is fixed to the
  // viewport, and results mount right below the caption

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  async function run(e) {
    e.preventDefault()
    if (!q.trim() || stage && stage !== 'done') return
    setErr(''); setR(null); sky.current?.reset()
    setStage('parse')
    let res
    try { res = await (await fetch('/search?q=' + encodeURIComponent(q))).json() }
    catch { setErr('pipeline server is not running — start ui/server.py'); setStage(null); return }
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

      {/* ── hero ── */}
      <motion.section style={{ opacity: heroFade, scale: heroScale }} css-ignore="true"
        className="hero">
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 26, position: 'relative', zIndex: 2, padding: '0 24px', textAlign: 'center' }}>
          <motion.h1 initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: 'clamp(56px, 9vw, 128px)', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.03em' }}>
            Crave it.<br /><span className="grad-text">Find it.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 1 }}
            style={{ fontSize: 'clamp(17px, 2vw, 22px)', color: 'var(--dim)', maxWidth: 560 }}>
            20,000 real recipes, mapped like stars.<br />Say what you feel like eating — the sky does the rest.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
            style={{ position: 'absolute', bottom: 36, color: 'var(--dim)', fontSize: 13, letterSpacing: '0.2em' }}>
            SCROLL
          </motion.div>
        </div>
      </motion.section>

      {/* ── chapters ── */}
      <section style={{ position: 'relative', zIndex: 2 }}>
        {[
          ['Every dish is a star.', 'Cortex reads each unstructured recipe and extracts its sensory truth — spicy 0.8, brothy 1.0 — with the exact ingredient lines as evidence. No evidence, no value.'],
          ['Say it like you feel it.', '“warm spicy soup, no shellfish” is not a keyword list. A live parser turns craving language into concepts, axes and hard exclusions.'],
          ['No means no.', 'Embeddings cannot subtract — an anti-join can. Dishes with what you excluded die out of the sky before ranking ever sees them. Measured: exclusion quality 0.245 → 0.855.'],
        ].map(([h, p], i) => (
          <motion.div key={i} {...fadeUp}
            style={{ minHeight: '78vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
              maxWidth: 760, margin: '0 auto', padding: '0 32px' }}>
            <h2 style={{ fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 18 }}>
              {i === 2 ? <span className="grad-text">{h}</span> : h}
            </h2>
            <p style={{ fontSize: 'clamp(16px, 1.6vw, 20px)', color: 'var(--dim)', maxWidth: 560 }}>{p}</p>
          </motion.div>
        ))}
      </section>

      {/* ── live search ── */}
      <section ref={searchRef} style={{ position: 'relative', zIndex: 2, minHeight: '100vh', padding: '12vh 32px 8vh' }}>
        <motion.form onSubmit={run} {...fadeUp}
          style={{ display: 'flex', gap: 12, maxWidth: 680, margin: '0 auto' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="a warm spicy soup, no shellfish…"
            style={{ flex: 1, background: 'rgba(16,16,24,.85)', border: '1px solid var(--line)', borderRadius: 16,
              padding: '18px 24px', color: 'var(--ink)', fontSize: 18, outline: 'none', backdropFilter: 'blur(8px)' }} />
          <button type="submit"
            style={{ background: 'var(--grad)', color: '#14060a', border: 'none', borderRadius: 16,
              padding: '0 30px', fontWeight: 700, fontSize: 17, fontFamily: 'Sora' }}>
            Search
          </button>
        </motion.form>
        {err && <p style={{ textAlign: 'center', color: '#ff5c82', marginTop: 18 }}>{err}</p>}

        {/* fast-changing stage captions */}
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            {stage && stage !== 'done' && (
              <motion.div key={stage}
                initial={{ opacity: 0, y: 26, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -26, filter: 'blur(6px)' }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                style={{ fontFamily: 'Sora', fontSize: 'clamp(20px, 3vw, 32px)', fontWeight: 600 }}>
                {STAGES[stage]}
                {stage === 'axes' && R && (
                  <span style={{ color: 'var(--dim)', fontWeight: 400 }}> — {R.concepts.join(' · ')}</span>
                )}
                {stage === 'excl' && R && (
                  <span className="grad-text"> — {R.excluded.length} dishes gone</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* result: five picks + recipe card */}
        <AnimatePresence>
          {stage === 'done' && R && (
            <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: 'flex', gap: 28, maxWidth: 1080, margin: '4vh auto 0', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {R.top.map((d, i) => (
                  <motion.button key={d.recipe_id} onClick={() => setPicked(i)}
                    initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.09 }}
                    whileHover={{ x: 6 }}
                    style={{ textAlign: 'left', background: picked === i ? 'var(--card)' : 'transparent',
                      border: '1px solid', borderColor: picked === i ? '#3a3a55' : 'transparent',
                      borderRadius: 14, padding: '13px 16px', color: 'var(--ink)', display: 'flex', gap: 12 }}>
                    <span className="grad-text" style={{ fontFamily: 'Sora', fontWeight: 700 }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{d.title}</span>
                  </motion.button>
                ))}
              </div>
              {dish && (
                <motion.div key={dish.recipe_id} layout
                  initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
                  style={{ flex: '2 1 420px', background: 'var(--card)', border: '1px solid var(--line)',
                    borderRadius: 22, padding: '28px 30px', maxHeight: '72vh', overflow: 'auto' }}>
                  <h3 style={{ fontSize: 24, fontWeight: 700 }}>{dish.title}</h3>
                  <p style={{ color: 'var(--dim)', fontSize: 14, margin: '4px 0 18px' }}>
                    match {dish.sim} — “{R.query}”
                  </p>
                  <Sect>why it matched</Sect>
                  {!dish.edges.length && (
                    <p style={{ color: '#ffb35c', fontSize: 15 }}>
                      No sensory axis covers this craving — ranked by profile similarity alone, and honest about it.
                    </p>
                  )}
                  {dish.edges.map(e => (
                    <div key={e.axis} style={{ margin: '14px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700 }}>
                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9d8cff' }}>{e.axis}</span>
                        <span style={{ color: 'var(--dim)' }}>{e.value} of {e.target}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#1d1d2e', margin: '7px 0', position: 'relative' }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${e.value * 100}%` }}
                          transition={{ duration: 0.9, ease: 'easeOut' }}
                          style={{ position: 'absolute', inset: '0 auto 0 0', borderRadius: 3, background: 'var(--grad)' }} />
                        <div style={{ position: 'absolute', left: `${e.target * 100}%`, top: -3, width: 2, height: 12, background: '#ffb35c' }} />
                      </div>
                      {e.evidence.map((ev, j) => (
                        <p key={j} style={{ fontSize: 13.5, color: 'var(--dim)', fontStyle: 'italic',
                          borderLeft: '2px solid #2c2c44', paddingLeft: 10, margin: '4px 0' }}>“{ev}”</p>
                      ))}
                    </div>
                  ))}
                  {dish.ingredients?.length > 0 && (<>
                    <Sect>ingredients</Sect>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {dish.ingredients.map((x, j) => (
                        <span key={j} style={{ background: '#1a1a28', borderRadius: 999, padding: '6px 13px',
                          fontSize: 13, color: '#c9c4de' }}>{x}</span>
                      ))}
                    </div>
                  </>)}
                  {dish.directions?.length > 0 && (<>
                    <Sect>how to make it</Sect>
                    {dish.directions.map((x, j) => (
                      <div key={j} style={{ display: 'flex', gap: 12, margin: '10px 0', fontSize: 14.5, color: '#b9b4cc' }}>
                        <span className="grad-text" style={{ fontFamily: 'Sora', fontWeight: 700, flex: 'none' }}>{j + 1}</span>
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

      {/* ── specs ── */}
      <section style={{ position: 'relative', zIndex: 2, padding: '16vh 32px', background: 'linear-gradient(180deg, transparent, rgba(10,10,18,.9) 30%)' }}>
        <motion.h2 {...fadeUp} style={{ textAlign: 'center', fontSize: 'clamp(30px, 4vw, 52px)', fontWeight: 700, marginBottom: 60 }}>
          Measured, <span className="grad-text">not claimed.</span>
        </motion.h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 22, maxWidth: 1000, margin: '0 auto' }}>
          {[
            ['0.844', 'NDCG@5 — enriched vectors + hard exclusion, the measured winner of four arms'],
            ['3.5×', 'exclusion quality vs the baseline (0.245 → 0.855) — embeddings cannot subtract'],
            ['20,000', 'recipes enriched in 21 minutes for about $90, meter-first'],
            ['386', 'blinded human judgments behind every number on this page'],
          ].map(([n, d], i) => (
            <motion.div key={i} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.1 }}
              style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 20, padding: '30px 26px' }}>
              <div className="grad-text" style={{ fontFamily: 'Sora', fontSize: 44, fontWeight: 800 }}>{n}</div>
              <p style={{ color: 'var(--dim)', fontSize: 14, marginTop: 10 }}>{d}</p>
            </motion.div>
          ))}
        </div>
        <motion.p {...fadeUp} style={{ textAlign: 'center', color: 'var(--dim)', fontSize: 13.5, marginTop: 60 }}>
          A retrieval study with an explanation layer — Snowflake Cortex end to end.<br />
          Honest limits and everything deferred: PLAN.md §v3 in the repo.
        </motion.p>
      </section>
    </>
  )
}

function Sect({ children }) {
  return <div style={{ font: '700 12px Sora', letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#6e6a8a', margin: '22px 0 10px', borderTop: '1px solid var(--line)', paddingTop: 16 }}>{children}</div>
}
