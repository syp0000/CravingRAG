import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

// Facts only from README.md / PLAN.md / eval/results_v2.md. Numbers are the
// 342-recipe dev-corpus results; the 20k live corpus is not judged.
// Voice: Siyeon, first person, plain words. No em dashes.
const PHASES = [
  ['1', '2026-07', 'A small test set and a first version',
    'I picked 342 recipes by hand. An AI rewrote each one as a description of how it tastes and feels, I turned those into numbers, and I ranked by closeness. I wrote 15 test cravings and graded the answers myself.'],
  ['2', '2026-08 W3', 'Eight taste dials and a hard "no"',
    'I gave every recipe eight dials (spicy, warm, brothy, savory, rich, fresh, sweet, comforting), each with the ingredient line that proves it. I also made "no almonds" a real filter that runs before ranking, not a hint.'],
  ['3', '2026-08 W3.3', 'A fair test of four versions',
    'I put every version\'s answers in one pile, hid which version each came from, and graded 386 of them. The winner was taste descriptions plus the hard "no": 0.844 on a scale where 1 is perfect.'],
  ['4', '2026-08 W5', 'Going from 342 to 20,000',
    'I checked the price on 1,000 recipes first ($4.55), then did 20,000 in 21 minutes for about $90. Then I built this star map and a way for a manager to ask questions about the catalog in plain English.'],
  ['5', '2026-08-26', 'Outside review and a paper trail',
    'Someone reviewed the project and found 36 problems. I fixed them the same day. Now every search writes down what it did and why, and you can read that record.'],
  ['6', '2026-08-26', 'What should the menu add next?',
    'I made a table of pretend search traffic (clearly labeled pretend), compared it with what the catalog actually has, and got a ranked list of gaps. Fresh + spicy is asked for 34 times more than it is offered.'],
]

// Each row: what step, which Snowflake feature does it, and why it mattered here.
const STRONG = [
  ['Reading recipes', 'AI_COMPLETE + JSON schema',
    'The AI reads each recipe inside the database and writes the eight dials as normal columns. I did not have to copy 20,000 recipes out to some other service and back. The rule "give proof or leave it blank" is enforced by the response format.'],
  ['Price', 'ACCOUNT_USAGE',
    'I can ask the database what a job cost. 1,000 recipes cost $4.55, so I knew 20,000 would be about $90 before I pressed go. The machine turns itself off after 60 seconds of doing nothing.'],
  ['Storage', 'VARIANT',
    'The dials and their proof live in one column right next to the recipe. If I want a ninth dial, I change the prompt, not the table.'],
  ['Search', 'VECTOR_COSINE_SIMILARITY + anti-join',
    'Ranking, the hard "no", and the dial filters all happen in one query. A separate search tool would hand me the top results first and leave "no shellfish" to me, and that is exactly the mistake I measured.'],
  ['Proof', 'the same VARIANT row',
    'The ingredient line that earned each dial is read from the same row that got ranked. Every answer carries its own proof with no second lookup.'],
  ['Questions', 'Semantic view + Cortex Analyst',
    'A manager can type "how many dishes are fresh and spicy?" and get an answer. The words and the math are defined once, so the manager and the search use the same numbers.'],
  ['Decisions', 'ANALYTICS next to V2',
    'Search traffic lands in the same database as the recipes, so "what people want" and "what we have" sit side by side. The menu decision is one query.'],
]

const ARMS = [
  ['plain recipe text (the control)', '0.582', '0.560'],
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
          I built CravingRAG on Snowflake. You type something like <em>“warm spicy soup, no shellfish”</em>.
          It looks through 20,000 real recipes, picks five, and shows you the exact ingredient line that made each one a match.
          It never invents a recipe. It only finds real ones and explains why.
        </p>
      </section>

      <Section title="What it does">
        <p style={{ marginBottom: 14 }}>
          Sometimes you know how you want food to feel but not what it is called. So I had an AI read every recipe once and
          give it a score from 0 to 1 on eight dials: spicy, warm, brothy, savory, rich, fresh, sweet, comforting. For each
          score it has to point at the ingredient line that proves it, like “3 tbsp chili powder” for spicy. If it cannot
          point at anything, the score stays blank. When you type a craving, your words get turned into the same dials, and
          the closest recipes come back.
        </p>
        <p>
          <b style={{ color: 'var(--ink)' }}>What “a hard filter that fails closed” means.</b> If you say “no almonds”, I do not
          just push almond recipes lower in the list. I remove them before ranking even starts. And if a recipe does not
          clearly show what is in it, so I cannot be sure there are no almonds, it gets removed too. “Fails closed” means:
          when in doubt, leave it out. A door that fails closed stays shut when the power goes off. I chose that over the
          other way round, because a wrong “no almonds” answer is worse than a missing one.
        </p>
      </Section>

      <Section title="Why Snowflake">
        <p style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 16 }}>
          I turned a pile of recipe text into a table once, and now both the search box and the business questions use
          that same table.
        </p>
        <p style={{ marginBottom: 14 }}>
          That is not how it started. At first this was just a search experiment: describe 342 recipes by taste, turn the
          descriptions into numbers, see if that finds better matches than the raw text. It did (0.582 became 0.844). But a
          search box that returns five soups is a feature, and a feature does not need a data warehouse. The reason for
          Snowflake showed up when I read the same dials backwards. Instead of “which dish fits this craving?”, ask “which
          cravings does this catalog fail at?”. I did not have to extract anything again. The columns I made for search
          were already the answer.
        </p>
        <p style={{ marginBottom: 18 }}>
          So the shape is: the AI reads each recipe where it already lives and writes the eight dials plus the proof, as
          plain columns. One read, one table, two kinds of users. You get five matches with their proof and your “no”
          respected. A restaurant manager gets to ask what the menu is missing. Nothing gets copied to a second system, so
          the search and the manager never disagree about the numbers. Here is where that helped, step by step:
        </p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {STRONG.map(([stage, feat, why]) => (
            <li key={stage} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) 1fr', gap: 18, padding: '14px 0', borderTop: '1px solid var(--rule)' }}>
              <div>
                <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--accent)' }}>{stage.toUpperCase()}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>{feat}</div>
              </div>
              <p style={{ color: 'var(--dim)', fontSize: 15 }}>{why}</p>
            </li>))}
        </ol>
        <p className="mono" style={{ fontSize: 11, color: '#6b675f', marginTop: 14, letterSpacing: '0.04em' }}>
          WHAT SNOWFLAKE DOES NOT FIX: THE AI STILL GIVES SLIGHTLY DIFFERENT ANSWERS EACH TIME (SO MY TEST PARSES ARE SAVED TO A FILE), AND THE ONLY REAL TRUTH IS A HUMAN GRADING THE RESULTS.
        </p>
      </Section>

      <Section title="How it works">
        <p style={{ marginBottom: 18 }}>
          The top row is one search. The boxes underneath are built once per recipe. Numbers find the closest recipes;
          the dials explain the match and block the ones you said no to. Hover a box or follow an arrow.
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
          I built four versions and tested them on the same 15 cravings over the same 342 recipes. I mixed all their answers
          into one pile, hid which version each answer came from, and graded 386 of them by hand. The score is NDCG@5: 1.0 means
          the five best recipes in the best order, 0 means nothing useful. P@5 is simply how many of the five were good.
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
          <li><b style={{ color: 'var(--ink)' }}>Describing taste first helps</b> (+0.150). Plain recipe text matches on words, so “without almonds” brought back five almond desserts. A taste description does not make that mistake as often.</li>
          <li><b style={{ color: 'var(--ink)' }}>The hard “no” is the biggest win.</b> On cravings with a “no” in them the score went from 0.245 to 0.855. Number-closeness cannot subtract things. A filter can.</li>
          <li><b style={{ color: 'var(--ink)' }}>Scoring the dials directly lost the ranking test</b> but it is what makes the proof and the filter possible, so it stayed.</li>
        </ul>
        <p style={{ marginTop: 18 }}>
          <b style={{ color: 'var(--ink)' }}>Why a person graded the answers, not an AI.</b> I tried letting an AI (llama, a different
          model from the one that reads the recipes) grade the results instead of me. It agreed with me about as often as I agree with
          myself on a second pass (κ 0.53 vs my own 0.624), so the number looked fine. I still threw it out, because its mistakes all
          went one way: it kept marking recipes as breaking a “no” when they did not. An AI grader that invents violations would have
          made the hard filter look better than it is. The recipe-reading AI makes things up too: it once described biscotti with no
          almonds in it as “Italian almond cookies”. So a human grades, and the ingredient list, not the AI’s description, decides
          what gets filtered.
        </p>
        <p className="mono" style={{ fontSize: 11, color: '#6b675f', marginTop: 14, letterSpacing: '0.04em' }}>
          THESE SCORES ARE FROM THE 342-RECIPE TEST SET. THE 20,000 LIVE RECIPES HAVE NOT BEEN GRADED.
        </p>
      </Section>

      <Section title="What I did, in order">
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

      <Section title="What should the menu add next?">
        <p style={{ marginBottom: 14 }}>
          The search page answers “what should I eat?”. The same table can answer a different question:
          <em> what do people keep asking for that we barely have?</em>
        </p>
        <ol style={{ paddingLeft: 18, color: 'var(--dim)', lineHeight: 1.7, marginBottom: 14 }}>
          <li><b style={{ color: 'var(--ink)' }}>What people want.</b> Every search becomes one row in a table (<span className="mono" style={{ fontSize: 13 }}>ANALYTICS.SEARCH_EVENTS</span>). I do not have real traffic yet, so I made 3,000 pretend searches from three made-up situations, wrote all my assumptions in one file (<span className="mono" style={{ fontSize: 13 }}>data/demand_scenarios.yml</span>), and labeled every row as pretend. I did not change the assumptions after seeing the results.</li>
          <li><b style={{ color: 'var(--ink)' }}>What we have.</b> How many real dishes score at least 0.6 on every dial the craving asks for. Fresh + spicy: 240 out of 19,260, which is 1.25% of the catalog.</li>
          <li><b style={{ color: 'var(--ink)' }}>The gap.</b> Divide the share of searches by the share of dishes. In the summer situation, fresh + spicy is 43% of searches but 1.25% of dishes, so it is asked for 34 times more than it is offered. That is the dish to add next, and it is one query: <span className="mono" style={{ fontSize: 13 }}>SELECT * FROM ANALYTICS.DEMAND_SUPPLY_GAPS ORDER BY opportunity_index DESC</span>.</li>
        </ol>
        <p>
          The <a href="#catalog" style={{ color: 'var(--accent)' }}>Catalog</a> page shows that table. Real searches from this
          demo are saved too, labeled <span className="mono" style={{ fontSize: 13 }}>live_demo</span>, but I keep them out of the
          math until there are enough of them to mean something.
        </p>
      </Section>

      <Section title="What is still weak">
        <p>
          I was the only person grading, and when I re-graded 29 pairs later I agreed with myself about two thirds of the time
          (κw 0.624). I wrote the 15 test cravings myself, knowing the recipes, so they are a checklist, not a fair exam. The
          “no” filter matches words in the ingredient list against a list of aliases; it is a preference filter, not allergy
          advice. With 20,000 recipes the catalog has lots of near-copies: “warm spicy soup” returns three hot-and-sour soups
          in the top five, because I only remove exact duplicate titles. The full list of open items is in PLAN.md, section v3.
        </p>
      </Section>

      <Section title="The paper trail">
        <p>
          Every search writes one record: what you typed, what the parser thought you meant, which words it searched for to
          apply your “no”, every recipe it threw out and why, the five it kept with their proof, and a link to the design
          decision that put the filter there. Click <b>WHY</b> on any result to read that record.
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
