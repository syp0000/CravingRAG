import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

// Facts only from README.md / PLAN.md / eval/results_v2.md. Numbers are the
// 342-recipe dev-corpus results; the 20k live corpus is not judged.
// Voice: Siyeon, first person, short. No em dashes.
const PHASES = [
  ['1', '2026-07', 'First version', 'I picked 342 recipes by hand, had an AI describe how each tastes, and ranked by closeness. I graded 15 test cravings myself.'],
  ['2', '2026-08 W3', 'Eight dials and a hard "no"', 'Every recipe got eight taste scores with proof. "No almonds" became a real filter, not a hint.'],
  ['3', '2026-08 W3.3', 'A fair test', 'Four versions, answers mixed in one pile, 386 graded blind. Winner: taste descriptions plus the hard "no", 0.844 out of 1.'],
  ['4', '2026-08 W5', '342 to 20,000', 'Checked the price on 1,000 first ($4.55), then did 20,000 in 21 minutes for about $90. Built this star map.'],
  ['5', '2026-08-26', 'Review and paper trail', 'An outside review found 36 problems. Fixed the same day. Every search now writes down what it did and why.'],
  ['6', '2026-08-26', 'What should the menu add?', 'Compared generated search traffic with what the catalog has. Fresh + spicy is asked for 34 times more than it is offered.'],
]

const STRONG = [
  ['Reading', 'AI_COMPLETE', 'The AI reads recipes inside the database and writes the dials as columns. Nothing leaves.'],
  ['Price', 'ACCOUNT_USAGE', 'I can ask what a job cost. 1,000 recipes were $4.55, so I knew 20,000 would be about $90 before pressing go.'],
  ['Storage', 'VARIANT', 'Dials and proof sit in one column next to the recipe. A ninth dial is a prompt change, not a new table.'],
  ['Search', 'VECTOR + anti-join', 'Ranking, the hard "no", and the dial filters run in one query. A separate search tool would leave the "no" to me.'],
  ['Questions', 'Cortex Analyst', 'A manager types "how many dishes are fresh and spicy?" and gets the same number the search uses.'],
  ['Decisions', 'ANALYTICS schema', 'Search traffic and recipes sit in the same database, so "what people want" meets "what we have" in one query.'],
]

const ARMS = [
  ['plain recipe text (control)', '0.582', '0.560'],
  ['eight dials, scored directly', '0.698', '0.747'],
  ['AI taste description', '0.732', '0.773'],
  ['AI taste description + hard "no"', '0.844', '0.880'],
]

export default function About() {
  const root = useRef(null)
  useGSAP(() => {
    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .addLabel('aboutIntro')
      .from('.about-hero-kicker', { autoAlpha: 0, y: 10, duration: 0.35 }, 'aboutIntro')
      .from('.about-hero-title', { autoAlpha: 0, y: 24, duration: 0.72 }, 'aboutIntro+=0.08')
      .from('.about-hero-copy', { autoAlpha: 0, y: 14, duration: 0.5 }, 'aboutIntro+=0.28')

    gsap.utils.toArray('.reveal').forEach(el => {
      gsap.from(el, { autoAlpha: 0, y: 24, duration: 0.6, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } })
    })
  }, { scope: root })

  return (
    <div ref={root} className="about-content" style={{ position: 'relative', zIndex: 2, maxWidth: 860, margin: '0 auto', padding: '110px 28px 120px' }}>
      <section className="hero about-hero" style={{ marginBottom: 72 }}>
        <div className="mono about-hero-kicker" style={{ fontSize: 12, letterSpacing: '0.26em', color: 'var(--dim)', marginBottom: 14 }}>ABOUT THIS PROJECT</div>
        <h1 className="about-hero-title">
          Say what you crave.<br /><span className="editorial-emphasis">Get real recipes, with the proof.</span>
        </h1>
        <p className="about-hero-copy" style={{ fontSize: 18, color: 'var(--dim)', maxWidth: 640 }}>
          Type something like <em>“warm spicy soup, no shellfish”</em>. It searches 20,000 real recipes, picks five, and shows
          the ingredient line that made each one a match. It never invents a recipe.
        </p>
      </section>

      <Section title="What it does">
        <p style={{ marginBottom: 14 }}>
          An AI read every recipe once and scored it on eight dials: spicy, warm, brothy, savory, rich, fresh, sweet, comforting.
          Each score must point at an ingredient line as proof (“3 tbsp chili powder” for spicy) or stay blank. Your craving gets
          turned into the same dials, and the closest recipes come back.
        </p>
        <p>
          <b style={{ color: 'var(--ink)' }}>“Fails closed”</b> means: when in doubt, leave it out. If you say “no almonds”, recipes with
          almonds are removed before ranking. Recipes that cannot prove they have no almonds are removed too. A wrong answer is worse
          than a missing one.
        </p>
      </Section>

      <Section title="Why Snowflake">
        <p style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
          I turned recipe text into a table once. The search box and the business questions both use that same table.
        </p>
        <p style={{ marginBottom: 18 }}>
          It started as a search experiment, and a search box alone does not need a data warehouse. The reason showed up when I
          read the same dials backwards: not “which dish fits this craving?” but “which cravings does this catalog fail at?”.
          Nothing had to be extracted again. Where that helped:
        </p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {STRONG.map(([stage, feat, why]) => (
            <li key={stage} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 150px) 1fr', gap: 18, padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent)' }}>{stage.toUpperCase()}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{feat}</div>
              </div>
              <p style={{ color: 'var(--dim)', fontSize: 15 }}>{why}</p>
            </li>))}
        </ol>
      </Section>

      <Section title="How it works">
        <p style={{ marginBottom: 18 }}>
          The top row is one search. The boxes underneath are built once per recipe. Hover a box or follow an arrow.
        </p>
        <div style={{ border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', background: '#0b0c10' }}>
          <iframe title="CravingRAG pipeline" src="/diagrams/craving-pipeline.html?theme=dark&embed=1"
            style={{ width: '100%', height: 'min(66vh, 600px)', border: 0, display: 'block' }} />
        </div>
        <p className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, letterSpacing: '0.06em' }}>
          docs/diagrams/craving-pipeline.dataflow.json · drawn with archify
        </p>
      </Section>

      <Section title="What I measured">
        <p style={{ marginBottom: 16 }}>
          Four versions, the same 15 cravings, the same 342 recipes. I mixed all answers in one pile, hid which version they came
          from, and graded 386 by hand. NDCG@5: 1.0 is the five best recipes in the best order. P@5: how many of the five were good.
        </p>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
            <th style={th}>version</th><th style={{ ...th, textAlign: 'right' }}>NDCG@5</th><th style={{ ...th, textAlign: 'right' }}>P@5</th></tr></thead>
          <tbody>{ARMS.map(([a, n, p], i) => (
            <tr key={a} style={{ color: i === 3 ? 'var(--ink)' : '#b5b1a8', fontWeight: i === 3 ? 600 : 400 }}>
              <td style={td}>{a}</td><td style={{ ...td, textAlign: 'right' }}>{n}</td><td style={{ ...td, textAlign: 'right' }}>{p}</td></tr>))}
          </tbody>
        </table>
        <ul style={{ marginTop: 18, paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7 }}>
          <li><b style={{ color: 'var(--ink)' }}>Describing taste first helps.</b> Plain text matches on words, so “without almonds” returned five almond desserts.</li>
          <li><b style={{ color: 'var(--ink)' }}>The hard “no” is the biggest win.</b> On cravings with a “no”, the score went from 0.245 to 0.855. Closeness cannot subtract. A filter can.</li>
          <li><b style={{ color: 'var(--ink)' }}>A person graded, not an AI.</b> I tried an AI grader. It agreed with me about as often as I agree with myself (κ 0.53 vs 0.624), but its mistakes all went one way: it invented “no” violations that were not there. That would have made the filter look better than it is.</li>
        </ul>
        <p className="mono" style={{ fontSize: 11, color: '#6b675f', marginTop: 14, letterSpacing: '0.04em' }}>
          SCORES ARE FROM THE 342-RECIPE TEST SET. THE 20,000 LIVE RECIPES ARE NOT GRADED.
        </p>
      </Section>

      <Section title="What I did, in order">
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {PHASES.map(([n, when, h, p]) => (
            <li key={n} className="reveal" style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 18, padding: '16px 0', borderTop: '1px solid var(--line)' }}>
              <div className="mono accent" style={{ fontSize: 22, fontWeight: 700 }}>{n.padStart(2, '0')}</div>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--dim)', marginBottom: 4 }}>{when.toUpperCase()}</div>
                <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>{h}</h3>
                <p style={{ color: 'var(--dim)', fontSize: 15 }}>{p}</p>
              </div>
            </li>))}
        </ol>
      </Section>

      <Section title="What should the menu add next?">
        <p style={{ marginBottom: 14 }}>
          The same table answers a second question: <em>what do people keep asking for that we barely have?</em>
        </p>
        <ul style={{ paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7, marginBottom: 14 }}>
          <li><b style={{ color: 'var(--ink)' }}>Demand:</b> 3,000 example searches I generated with AI for the demo, in three situations. Labeled as generated, never tuned after the results.</li>
          <li><b style={{ color: 'var(--ink)' }}>Supply:</b> real. Fresh + spicy: 240 of 19,260 recipes, 1.25%.</li>
          <li><b style={{ color: 'var(--ink)' }}>Gap:</b> demand share divided by supply share. Fresh + spicy on a hot summer day: 43% of searches, 1.25% of dishes, 34× under-supplied. That is the dish to add.</li>
        </ul>
        <p>See the <a href="#catalog" style={{ color: 'var(--accent)' }}>Catalog</a> page.</p>
      </Section>

      <Section title="What is still weak">
        <ul style={{ paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7 }}>
          <li><b style={{ color: 'var(--ink)' }}>It still gets things wrong.</b> A sentence is a thin description of what you want. What helped most was asking for more: the “fine-tune your search” box (cuisine, spice, richness, things to avoid). Type the craving, then open the filters.</li>
          <li><b style={{ color: 'var(--ink)' }}>One grader.</b> Me. Re-grading 29 pairs later, I agreed with myself about two thirds of the time.</li>
          <li><b style={{ color: 'var(--ink)' }}>My own test questions.</b> I wrote the 15 cravings knowing the recipes. A checklist, not a fair exam.</li>
          <li><b style={{ color: 'var(--ink)' }}>Near-copies.</b> “warm spicy soup” returns three hot-and-sour soups, because I only remove exact duplicate titles.</li>
          <li><b style={{ color: 'var(--ink)' }}>Not allergy advice.</b> The “no” filter matches words in the ingredient list. It is a preference filter.</li>
        </ul>
        <p style={{ marginTop: 10, color: 'var(--dim)' }}>Full list: PLAN.md, section v3.</p>
      </Section>

      <Section title="The paper trail">
        <p>
          Every search writes one record: what you typed, what the parser thought you meant, every recipe it threw out and why,
          and the five it kept with their proof. Click <b>WHY</b> on any result to read it.
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
