// Detail panel: one dish, why it matched (axis bars + quoted evidence), then the recipe.
export default function RecipeDetail({ dish, index, decisionId, open, onBack, onNewSearch }) {
  return (
    <aside className={`panel recipe-panel ${open ? 'panel--open' : ''}`} aria-label="Recipe detail">
      <div className="recipe-panel-header">
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)', marginBottom: 10,
          display: 'flex', justifyContent: 'space-between' }}>
          <span>RECIPE DETAIL{decisionId && <> · <a href={'/why?id=' + decisionId} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}>WHY ↗</a></>}</span>
          <button type="button" onClick={onBack} className="panel-back mono">← RESULTS</button>
          <button type="button" onClick={onNewSearch} className="panel-new mono">NEW SEARCH</button>
        </div>
      </div>
      {dish && (
        <div key={dish.recipe_id} className="dish recipe-panel-body">
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--dim)' }}>
            {String(index + 1).padStart(2, '0')} · SIMILARITY {dish.sim}
          </div>
          <h3 className="recipe-title">{dish.title}</h3>
          <Sect>why it matched</Sect>
          <Evidence edges={dish.edges} />
          {dish.ingredients?.length > 0 && <>
            <Sect>ingredients</Sect>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dish.ingredients.map((x, j) => <span key={`${j}:${x}`} className="mono" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '4px 9px', fontSize: 11.5, color: '#b5b1a8' }}>{x}</span>)}
            </div></>}
          {dish.directions?.length > 0 && <>
            <Sect>directions</Sect>
            {dish.directions.map((x, j) => (
              <div key={`${j}:${x}`} style={{ display: 'flex', gap: 12, margin: '9px 0', fontSize: 13.5, color: '#c2beb4' }}>
                <span className="mono accent" style={{ fontSize: 12, flex: 'none', paddingTop: 2 }}>{String(j + 1).padStart(2, '0')}</span><span>{x}</span>
              </div>))}</>}
          <div className="mono" style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 12, fontSize: 10.5, letterSpacing: '0.06em', color: '#6b675f', lineHeight: 1.7 }}>
            MATCHES ARE AI-EXTRACTED AND CAN BE WRONG. INGREDIENT EXCLUSION IS A PREFERENCE FILTER, NOT ALLERGY OR MEDICAL GUIDANCE.
          </div>
        </div>)}
    </aside>
  )
}

export function Evidence({ edges }) {
  if (!edges.length) return <p style={{ color: 'var(--accent)', fontSize: 14 }}>
    No sensory axis covers this craving. Ranked by profile similarity alone, and logged as such.</p>
  return edges.map(e => (
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
        <p key={`${j}:${ev}`} style={{ fontSize: 13, color: 'var(--dim)', fontStyle: 'italic', borderLeft: '2px solid var(--line)', paddingLeft: 10, margin: '3px 0' }}>“{ev}”</p>))}
    </div>))
}

function Sect({ children }) {
  return <div className="mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--dim)', margin: '20px 0 9px', borderTop: '1px solid var(--line)', paddingTop: 13 }}>{children}</div>
}
