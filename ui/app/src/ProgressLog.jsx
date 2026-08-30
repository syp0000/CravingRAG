import { LOG, excludedCount } from './journey.js'

function StageNote({ stage, result }) {
  if (!result) return null
  if (stage === 'axes') return <span style={{ color: 'var(--dim)' }}>  [{result.concepts.join(' / ') || 'no axis, vector only'}]</span>
  if (stage === 'excl') return <span className="accent">  −{excludedCount(result)} dishes</span>
  return null
}

export default function ProgressLog({ stage, busy, query, params, result }) {
  return (
    <div className="mono progress-log journey-status" aria-live="polite">
      {stage && <div className="progress-query">
        “{query}”{params.length > 0 && <span className="accent"> · {params.join(' / ').toUpperCase()}</span>}
      </div>}
      {busy && <div key={stage} className="stage progress-stage">
        <span className="accent">▶</span> {LOG[stage]}<StageNote stage={stage} result={result} />
      </div>}
    </div>
  )
}
