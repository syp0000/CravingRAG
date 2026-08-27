import { useEffect, useState } from 'react'
import { gapsApi } from './api.js'

// Catalog Intelligence: the product decision, read straight from ANALYTICS.DEMAND_SUPPLY_GAPS
// (sql/16). Demand is SYNTHETIC (data/demand_scenarios.yml); supply is the real catalog.
// Three made-up situations. None of this is real traffic: I wrote the shares in
// data/demand_scenarios.yml before running anything and did not change them after.
const SCENARIOS = {
  baseline: ['Normal day',
    'Searches for everyday food: mostly warm and comforting, a little fresh and spicy.'],
  phoenix_summer: ['Hot summer',
    'Same people on a very hot day in Phoenix, so more searches for fresh, light and spicy food.'],
  dietary_access: ['Food allergies',
    'Every search says "no" to one thing: dairy, peanuts, shellfish or almonds.'],
}

export default function Catalog() {
  const [D, setD] = useState(null)
  const [err, setErr] = useState('')
  const [scenario, setScenario] = useState('phoenix_summer')
  useEffect(() => {
    gapsApi().then(d => d.error ? setErr(d.error) : setD(d))
      .catch(() => setErr('PIPELINE OFFLINE. START ui/server.py'))
  }, [])

  const rows = (D?.gaps || []).filter(g => g.scenario_id === scenario)
  const top = rows[0]
  const maxOpp = Math.max(1, ...rows.map(r => r.opportunity_index))

  return (
    <div style={{ position: 'relative', zIndex: 2, maxWidth: 960, margin: '0 auto', padding: '110px 28px 120px' }}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: '0.26em', color: 'var(--dim)', marginBottom: 14 }}>CATALOG INTELLIGENCE</div>
      <h1 style={{ marginBottom: 12 }}>What people ask for <span className="editorial-emphasis">that the menu does not offer.</span></h1>
      <p style={{ fontSize: 17, color: 'var(--dim)', maxWidth: 680, marginBottom: 18 }}>
        One question: what do people keep asking for that we barely have, so what should we add next?
      </p>
      <p style={{ fontSize: 15.5, color: 'var(--dim)', maxWidth: 680, marginBottom: 36, lineHeight: 1.7 }}>
        The recipe counts are real. The searches are not: I do not have real users yet, so I generated 3,000 example
        searches with AI for this demo, split into three situations you can switch between below.
      </p>

      {err && <p className="mono" style={{ color: 'var(--accent)' }}>{err}</p>}
      {!D && !err && <p className="mono" style={{ color: 'var(--dim)' }}>LOADING SNOWFLAKE MART</p>}

      {D && <>
        <div className="mono" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28, fontSize: 12 }}>
          {Object.entries(SCENARIOS).map(([k, [label]]) => (
            <button key={k} onClick={() => setScenario(k)} className="chip" aria-pressed={scenario === k}
              style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', letterSpacing: '0.08em',
                background: scenario === k ? 'var(--accent)' : 'transparent', color: scenario === k ? '#08090b' : 'var(--ink)' }}>
              {k.toUpperCase()} <span style={{ opacity: 0.7 }}>· {label}</span>
            </button>))}
        </div>
        <p style={{ fontSize: 15, color: 'var(--dim)', maxWidth: 680, marginBottom: 28, lineHeight: 1.7 }}>
          <b style={{ color: 'var(--ink)' }}>{SCENARIOS[scenario][0]}.</b> {SCENARIOS[scenario][1]}
        </p>

        {top && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '22px 24px', marginBottom: 36, background: 'var(--card)' }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', color: 'var(--accent)', marginBottom: 10 }}>DECISION · ADD NEXT</div>
            <h2 style={{ fontSize: 28, marginBottom: 8 }}>{top.intent_key.replace('_', ' + ')}</h2>
            <p style={{ color: 'var(--dim)', fontSize: 15.5 }}>
              {pct(top.demand_share)} of searches in this scenario, {pct(top.supply_share)} of the catalog
              ({top.matching_dishes.toLocaleString()} of {D.intents[0].catalog_size.toLocaleString()} dishes).
              Demand is <b style={{ color: 'var(--ink)' }}>{top.opportunity_index}×</b> the supply.
            </p>
          </div>)}

        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
            <th style={th}>intent</th><th style={th}>demand</th><th style={th}>supply</th>
            <th style={{ ...th, textAlign: 'right' }}>dishes</th><th style={{ ...th, width: '34%' }}>opportunity</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.intent_key} style={{ color: r === top ? 'var(--ink)' : '#b5b1a8' }}>
              <td style={td}>{r.intent_key}</td>
              <td style={td}>{pct(r.demand_share)}</td>
              <td style={td}>{pct(r.supply_share)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.matching_dishes.toLocaleString()}</td>
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--rule)', borderRadius: 3 }}>
                    <div style={{ width: `${100 * r.opportunity_index / maxOpp}%`, height: '100%', borderRadius: 3,
                      background: r.opportunity_index >= 1 ? 'var(--accent)' : '#4a4b50' }} />
                  </div>
                  <span style={{ minWidth: 44, textAlign: 'right' }}>{r.opportunity_index}×</span>
                </div>
              </td>
            </tr>))}
          </tbody>
        </table>
        <p style={{ fontSize: 15, color: 'var(--dim)', maxWidth: 680, marginTop: 18, lineHeight: 1.7 }}>
          <b style={{ color: 'var(--ink)' }}>demand</b>: how often people searched for it. <b style={{ color: 'var(--ink)' }}>supply</b>: how much of
          the catalog can serve it. <b style={{ color: 'var(--ink)' }}>opportunity</b>: demand divided by supply. 34× means people ask for it 34
          times more than we have it. Blue bar: we need more of this. Grey bar: we already have enough.
        </p>
        <p className="mono" style={{ fontSize: 11, color: '#6b675f', marginTop: 12, letterSpacing: '0.04em', lineHeight: 1.7 }}>
          DEMAND: SYNTHETIC_DEMO v{top?.generator_version} SEED {top?.seed}, 3,000 EVENTS OVER 30 DAYS FROM data/demand_scenarios.yml.
          SUPPLY: V2.RECIPE_AXES, CORTEX-EXTRACTED, ≥0.6 ON EACH TARGET AXIS.<br />
          LIVE SEARCHES RECORDED SO FAR: {D.live.searches} (source = live_demo, not in the ratios above).
        </p>
      </>}
    </div>
  )
}

const pct = x => (100 * x).toFixed(x < 0.02 ? 2 : 1) + '%'
const th = { padding: '8px 6px', borderBottom: '1px solid var(--line)', fontWeight: 500, letterSpacing: '0.08em' }
const td = { padding: '10px 6px', borderBottom: '1px solid var(--rule)' }
