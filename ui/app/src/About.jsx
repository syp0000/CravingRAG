import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

// Facts only from README.md / PROGRESS.md / eval/results_v2.md. Numbers are the
// 342-recipe dev-corpus results; the 20k live corpus is not judged.
const PHASES = [
  ['1', '2026-07', 'Curated corpus + V1 baseline',
    '342 hand-curated RecipeNLG recipes. An LLM rewrites each into a sensory profile, embeds it, ranks by cosine. 15 frozen queries, human judged.'],
  ['2', '2026-08 W3', 'V2 structured axes + hard exclusion',
    '8 sensory axes with an evidence-or-NULL contract, a hand-edited concept wiki, and exclusion as a fail-closed anti-join that runs before ranking.'],
  ['3', '2026-08 W3.3', 'Pooled four-arm evaluation',
    'One blinded pool, one shared ideal ranking, 386 human judgments. Enriched vectors + hard exclusion wins: NDCG@5 0.844.'],
  ['4', '2026-08 W5', 'Scale + product',
    '20,000 recipes enriched in 21 minutes for about $90, meter read first. The constellation UI and a semantic view for Cortex Analyst.'],
  ['5', '2026-08-26', 'Adversarial review + provenance',
    '36 findings from an outside review fixed the same day. Every search now writes a decision record you can trace back to the measurement that shaped the system.'],
]

const ARMS = [
  ['raw recipe text → embedding (control)', '0.582', '0.560'],
  ['structured 8-axis scoring', '0.698', '0.747'],
  ['LLM sensory profile → embedding', '0.732', '0.773'],
  ['profile embedding + hard exclusion', '0.844', '0.880'],
]

export default function About() {
  const root = useRef(null)
  useGSAP(() => {
    gsap.from('.hero > *', { autoAlpha: 0, y: 18, duration: 0.7, stagger: 0.08, ease: 'power2.out' })
    gsap.utils.toArray('.reveal').forEach(el => {
      gsap.from(el, { autoAlpha: 0, y: 24, duration: 0.6, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } })
    })
  }, { scope: root })

  return (
    <div ref={root} style={{ position: 'relative', zIndex: 2, maxWidth: 860, margin: '0 auto', padding: '110px 28px 120px' }}>
      <section className="hero" style={{ marginBottom: 72 }}>
        <div className="mono" style={{ fontSize: 12, letterSpacing: '0.26em', color: 'var(--dim)', marginBottom: 14 }}>ABOUT THIS PROJECT</div>
        <h1 style={{ fontSize: 'clamp(38px, 6vw, 72px)', fontWeight: 900, lineHeight: 1.02, letterSpacing: '-0.02em', marginBottom: 20 }}>
          Say what you crave.<br /><span className="accent">Get real recipes, with the evidence.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--dim)', maxWidth: 640 }}>
          CravingRAG is a retrieval study built on Snowflake. Type a craving like <em>“warm spicy soup, no shellfish”</em>.
          Twenty thousand real recipes narrow to five, and every match shows the exact ingredient line that earned it.
          Nothing is generated; everything is retrieved and explained.
        </p>
      </section>

      <Section title="What it does">
        <p>
          A recipe is hard to describe by name when you only know how you want to feel. This system reads each recipe once,
          charts it on eight sensory axes (spicy, warm, brothy, rich, ...), keeps the ingredient lines as proof, and turns
          your sentence into the same coordinates. Things you refuse (“no almonds”) are removed by a hard filter that fails
          closed: if a recipe cannot prove the almond is absent, it is out.
        </p>
      </Section>

      <Section title="How it works">
        <p style={{ marginBottom: 18 }}>
          The main row is one search. The stores below are built once per recipe. Vectors rank; structured axes explain and
          gate. Hover a node or trace a flow inside the diagram.
        </p>
        <div style={{ border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', background: '#0b0c10' }}>
          <iframe title="CravingRAG pipeline" src="/diagrams/craving-pipeline.html?theme=dark&embed=1"
            style={{ width: '100%', height: 'min(66vh, 600px)', border: 0, display: 'block' }} />
        </div>
        <p className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, letterSpacing: '0.06em' }}>
          docs/diagrams/craving-pipeline.dataflow.json · rendered with archify
        </p>
      </Section>

      <Section title="What was measured">
        <p style={{ marginBottom: 16 }}>
          Four retrieval arms, one blinded human-judged pool (386 judgments), 15 frozen queries, 342-recipe dev corpus.
        </p>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
            <th style={th}>arm</th><th style={{ ...th, textAlign: 'right' }}>NDCG@5</th><th style={{ ...th, textAlign: 'right' }}>P@5</th></tr></thead>
          <tbody>{ARMS.map(([a, n, p], i) => (
            <tr key={a} style={{ color: i === 3 ? 'var(--ink)' : '#b5b1a8', fontWeight: i === 3 ? 600 : 400 }}>
              <td style={td}>{a}</td><td style={{ ...td, textAlign: 'right' }}>{n}</td><td style={{ ...td, textAlign: 'right' }}>{p}</td></tr>))}
          </tbody>
        </table>
        <ul style={{ marginTop: 18, paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7 }}>
          <li><b style={{ color: 'var(--ink)' }}>Enrichment works</b> (+0.150): rewriting recipes into sensory profiles before embedding beats raw text.</li>
          <li><b style={{ color: 'var(--ink)' }}>Hard exclusion is the biggest lever</b>: exclusion-query NDCG 0.245 → 0.855. Embeddings cannot subtract; an anti-join can.</li>
          <li><b style={{ color: 'var(--ink)' }}>Structured scoring loses the ranking war</b> but powers the exclusion’s evidence and the whole explanation layer.</li>
        </ul>
        <p className="mono" style={{ fontSize: 11, color: '#6b675f', marginTop: 14, letterSpacing: '0.04em' }}>
          THESE ARE DEV-CORPUS NUMBERS. THE 20K LIVE CORPUS IS ENRICHED BUT NOT RE-JUDGED.
        </p>
      </Section>

      <Section title="Process done">
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {PHASES.map(([n, when, h, p]) => (
            <li key={n} className="reveal" style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 18, padding: '18px 0', borderTop: '1px solid var(--line)' }}>
              <div className="mono accent" style={{ fontSize: 22, fontWeight: 700 }}>{n.padStart(2, '0')}</div>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--dim)', marginBottom: 4 }}>{when.toUpperCase()}</div>
                <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{h}</h3>
                <p style={{ color: 'var(--dim)', fontSize: 15 }}>{p}</p>
              </div>
            </li>))}
        </ol>
      </Section>

      <Section title="Honest limits">
        <p>
          Single annotator (test-retest κw 0.624). 15 dev-set queries written with answers in mind: an acceptance suite, not a
          neutral benchmark. Exclusion is substring matching over an alias table, a preference filter and not allergy guidance.
          Open items live in PROGRESS.md.
        </p>
      </Section>

      <Section title="Decision provenance">
        <p>
          Every search writes one record: the query, what the parser heard, the exclusion needles, every candidate rejected and
          why, the five picks with their evidence, and a link to the architecture decision that put the filter there. Open
          <b> WHY</b> on any result to walk that chain back to the measurement.
        </p>
      </Section>
    </div>
  )
}

const th = { padding: '8px 6px', borderBottom: '1px solid var(--line)', fontWeight: 500, letterSpacing: '0.08em' }
const td = { padding: '10px 6px', borderBottom: '1px solid var(--rule)' }

function Section({ title, children }) {
  return (
    <section className="reveal" style={{ marginBottom: 64 }}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.22em', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        {title.toUpperCase()} <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ fontSize: 16.5, color: '#c9c5bb', lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}
