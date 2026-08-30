import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

// Facts only from README.md / docs/PLAN.md / eval/results_v2.md. Numbers are the
// 342-recipe dev-corpus results; the 20k live corpus is not judged.
// Voice: Siyeon, first person, short. No em dashes.
const PHASES = [
  ['1', '2026-07', 'The first version', 'I hand-picked 342 recipes, asked an AI to describe how each one tastes, and ranked them by similarity. Then I tested 15 cravings and graded the results myself.'],
  ['2', '2026-08 W3', 'Eight taste signals and a firm "no"', 'Each recipe received eight evidence-backed taste scores. Requests like "no almonds" became strict filters instead of gentle suggestions.'],
  ['3', '2026-08 W3.3', 'A fairer comparison', 'I tested four versions, mixed all the results together, hid which version produced each one, and graded 386 results. The best version scored 0.844 out of 1.'],
  ['4', '2026-08 W5', 'From 342 to 20,000 recipes', 'I tested the cost on 1,000 recipes first ($4.55). Then I processed 20,000 recipes in 21 minutes for about $90 and built the recipe map you see here.'],
  ['5', '2026-08-26', 'Review and accountability', 'An outside review found 36 issues, which I fixed the same day. Every search now records what happened and why.'],
  ['6', '2026-08-26', 'A new question', 'I compared sample search demand with the recipes in the catalog. The biggest gap was fresh and spicy food: people asked for it 34 times more often than the catalog offered it.'],
]

const STRONG = [
  ['Reading', 'AI_COMPLETE', 'The AI reads each recipe inside the database and saves its taste scores there. The recipe data never has to move elsewhere.'],
  ['Cost', 'ACCOUNT_USAGE', 'Snowflake shows the cost of each job. Processing 1,000 recipes cost $4.55, which gave me a reliable estimate before I processed all 20,000.'],
  ['Storage', 'VARIANT', 'The taste scores and their supporting evidence live beside each recipe. Adding another taste signal would mean changing the AI prompt, not redesigning the database.'],
  ['Search', 'VECTOR + anti-join', 'Ranking, taste filters, and strict exclusions such as "no almonds" all happen in one query.'],
  ['Questions', 'Cortex Analyst', 'Someone can ask, "How many dishes are fresh and spicy?" in plain English and get an answer based on the same data used by search.'],
  ['Decisions', 'ANALYTICS schema', 'Search demand and the recipe catalog live in the same database, so I can compare what people want with what the catalog actually offers.'],
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
          Type something like <em>“warm spicy soup, no shellfish”</em>. CravingRAG searches 20,000 real recipes, finds up to five
          strong matches, and shows you the evidence behind each one. If fewer than five hold up, it shows fewer. It recommends recipes that already exist. It never makes them up.
        </p>
      </section>

      <Section title="What it does">
        <p style={{ marginBottom: 14 }}>
          When recipes are added to the catalog, an AI reads each one once and saves eight taste scores: spicy, warm, brothy,
          savory, rich, fresh, sweet, and comforting. Searches reuse those stored scores. The AI does not reread all 20,000 recipes
          every time someone searches.
        </p>
        <p style={{ marginBottom: 14 }}>
          Every score must be supported by the recipe itself. For example, a high spicy score might point to “3 tbsp chili powder.”
          If the AI cannot find evidence, it leaves that score blank.
        </p>
        <p style={{ marginBottom: 14 }}>
          When you describe a craving, the search turns your words into the same eight qualities and looks for the closest matches.
          That is how a phrase like “something cozy but not too rich” can lead to recipes that feel right, even when they do not use
          those exact words.
        </p>
        <p>
          Exclusions are treated as rules, not suggestions. If you ask for “no almonds,” recipes that list almonds are removed before
          ranking. Recipes with unclear ingredient information are left out too. The system is intentionally cautious: showing fewer
          results is better than knowingly showing the wrong one.
        </p>
      </Section>

      <Section title="Why Snowflake">
        <p style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 14 }}>
          I turned unstructured recipe text into useful data once. Both the search experience and the catalog analysis use that same data.
        </p>
        <p style={{ marginBottom: 18 }}>
          A recipe search alone does not need a data warehouse. Snowflake became valuable when I started asking the question in reverse.
          Instead of only asking, “Which recipe fits this craving?” I could also ask, “Which cravings does this catalog fail to satisfy?”
          I did not need to process the recipes again to find out.
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
          The top row of the diagram follows a single search from the words you type to the recipes you see. The lower rows show the
          work that happens once for each recipe. Hover over a box or follow the arrows to explore the flow.
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
          I compared four versions of the search using the same 15 cravings and the same 342 recipes. I mixed the results together,
          hid which version produced each one, and graded 386 results by hand. NDCG@5 measures whether the best five recipes appear
          in the best order. P@5 measures how many of those five are actually good matches.
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
          <li><b style={{ color: 'var(--ink)' }}>Describing taste before searching helped.</b> Plain text search focuses on matching words. In one test, “without almonds” returned five almond desserts because the word “almonds” appeared in both the request and the recipes.</li>
          <li><b style={{ color: 'var(--ink)' }}>Strict exclusions made the biggest difference.</b> For cravings that included a “no,” the score rose from 0.245 to 0.855. Similarity can find what belongs, but it cannot reliably remove what does not. A filter can.</li>
          <li><b style={{ color: 'var(--ink)' }}>I graded the results myself.</b> I also tried an AI grader, but it sometimes claimed a recipe broke an exclusion when it did not. That bias would have made the strict filter look better than it really was.</li>
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
          The same recipe data can answer a broader question: <em>What do people keep asking for that the catalog barely offers?</em>
        </p>
        <ul style={{ paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7, marginBottom: 14 }}>
          <li><b style={{ color: 'var(--ink)' }}>Demand:</b> For this demo, I used AI to generate 3,000 sample searches across three situations. The data is clearly labeled as generated, and I did not adjust it after seeing the results.</li>
          <li><b style={{ color: 'var(--ink)' }}>Supply:</b> The recipe catalog is real. Only 240 of 19,260 searchable recipes, or 1.25%, are both fresh and spicy.</li>
          <li><b style={{ color: 'var(--ink)' }}>The gap:</b> On a hot summer day, 43% of the sample searches asked for fresh and spicy food, while only 1.25% of the catalog offered it. That makes fresh and spicy dishes 34 times under-supplied and a strong candidate for the next menu addition.</li>
        </ul>
        <p>Explore the details on the <a href="#catalog" style={{ color: 'var(--accent)' }}>Catalog</a> page.</p>
      </Section>

      <Section title="Where it still falls short">
        <ul style={{ paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7 }}>
          <li><b style={{ color: 'var(--ink)' }}>A short request leaves room for error.</b> One sentence cannot capture everything you want. The fine-tuning filters for cuisine, spice, richness, and ingredients to avoid help fill in the gaps.</li>
          <li><b style={{ color: 'var(--ink)' }}>The evaluation had one grader: me.</b> When I graded 29 pairs a second time, I agreed with my original decision about two thirds of the time.</li>
          <li><b style={{ color: 'var(--ink)' }}>I wrote the test cravings.</b> I already knew which recipes were in the collection, so the test is closer to a useful checklist than an independent exam.</li>
          <li><b style={{ color: 'var(--ink)' }}>Duplicate grouping is a heuristic.</b> Near-identical dishes (three hot-and-sour soups) now count as one result, and drinks stay out of food searches — but both rules read titles and can occasionally merge or keep the wrong recipe.</li>
          <li><b style={{ color: 'var(--ink)' }}>This is not allergy advice.</b> The exclusion filter looks for words in the ingredient list. It is designed for preferences, not medical safety.</li>
        </ul>
        <p style={{ marginTop: 10, color: 'var(--dim)' }}>The full list of known limitations is in docs/PLAN.md, section v3.</p>
      </Section>

      <Section title="The paper trail">
        <p>
          Every search creates a record of what you typed, how the system interpreted it, which recipes it removed and why, and which
          it kept. Click <b>WHY</b> on any result to see the evidence behind that recommendation.
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
