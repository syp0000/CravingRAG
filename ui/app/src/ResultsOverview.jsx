export default function ResultsOverview({ query, params, results, picked, onPick, onEdit }) {
  // Lean V3: what the quality layer read out of the query (absent on pre-V3 gallery JSON)
  const it = results.interpretation
  const interp = it ? [it.drink_allowed ? 'FOOD OR DRINK' : 'FOOD',
    ...(it.required_identity || []), ...(it.requested_components || [])].map(s => s.toUpperCase()) : []
  return (
    <section className="results-overview">
      <div className="results-kicker mono"><span className="status-dot" /> SEARCH COMPLETE · {results.top.length} MATCHES</div>
      <div className="results-heading-row">
        <div>
          <div className="results-label mono">RECIPES FOR</div>
          <h1 className="results-query">“{query}”</h1>
        </div>
        <button type="button" onClick={onEdit} className="edit-search mono">← EDIT SEARCH</button>
      </div>
      {params.length > 0 && <div className="results-params mono">{params.join(' · ').toUpperCase()}</div>}
      {interp.length > 0 && <div className="results-params mono">INTERPRETED AS · {interp.join(' · ')}</div>}
      {results.top.length === 0 ? <NoMatch /> : <RankedList results={results} picked={picked} onPick={onPick} />}
      <p className="results-disclaimer mono">AI-EXTRACTED MATCHES CAN BE WRONG · EXCLUSION IS NOT ALLERGY GUIDANCE</p>
    </section>
  )
}

function NoMatch() {
  return (
    <div className="no-match">
      <p className="results-guide">No strong matches satisfied every part of this craving — showing none rather than padding the list.</p>
      <p className="results-guide" style={{ color: 'var(--dim)' }}>
        Try removing one exclusion, broadening the dish type, or wording the craving differently.</p>
    </div>
  )
}

const countWord = n => n === 5 ? 'Five' : n
const matchedAxes = d => d.edges?.length ? d.edges.slice(0, 3).map(e => e.axis).join(' · ').toUpperCase() : 'PROFILE SIMILARITY MATCH'

function RankedList({ results, picked, onPick }) {
  const n = results.top.length
  return (
    <>
      <p className="results-guide">{countWord(n)} destination{n === 1 ? '' : 's'} found. Choose one to inspect why it matched, then follow the recipe in the detail panel.</p>
      <div className="ranked-results" aria-label="Ranked recipe results">
        {results.top.map((d, i) => (
          <button type="button" key={d.recipe_id} onClick={() => onPick(i)}
            className={`result-row ${picked === i ? 'result-row--active' : ''}`} aria-current={picked === i ? 'true' : undefined}>
            <span className="result-rank mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="result-main">
              <span className="result-title">{d.title}</span>
              <span className="result-reason mono">{matchedAxes(d)}</span>
            </span>
            <span className="result-score mono">{d.sim}</span>
            <span className="result-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </>
  )
}

