// Fine-tune controls. Values are the exact strings ui/server.py validates.
const CUISINES = ['korean', 'thai', 'indian', 'japanese', 'chinese', 'italian', 'mexican', 'american']
const SPICE_LEVELS = [['', 'any'], ['none', 'none'], ['mild', 'mild'], ['medium', 'medium'], ['fire', 'fire']]
const RICH_LEVELS = [['', 'any'], ['light', 'light'], ['rich', 'rich & creamy']]
const AVOIDABLE = ['shellfish', 'peanut', 'almond', 'dairy', 'cilantro', 'pork']

const toggle = (list, item) => list.includes(item) ? list.filter(x => x !== item) : [...list, item]

export default function Filters({ filters, onChange, activeCount }) {
  const { cuisines, spice, rich, avoid } = filters
  const set = patch => onChange({ ...filters, ...patch })
  return (
    <details className="filters liquid-glass">
      <summary className="mono">
        <span>FINE-TUNE YOUR SEARCH</span>
        <span className="filter-summary-meta">{activeCount ? `${activeCount} ACTIVE` : 'OPTIONAL'} <span className="summary-plus">+</span></span>
      </summary>
      <div className="filter-body">
        <ParamRow label="CUISINE">
          {CUISINES.map(c => (
            <Chip key={c} on={cuisines.includes(c)} onClick={() => set({ cuisines: toggle(cuisines, c) })}>{c}</Chip>))}
        </ParamRow>
        <ParamRow label="SPICE">
          {SPICE_LEVELS.map(([v, l]) => (
            <Chip key={l} on={spice === v} onClick={() => set({ spice: v })}>{l}</Chip>))}
        </ParamRow>
        <ParamRow label="RICHNESS">
          {RICH_LEVELS.map(([v, l]) => (
            <Chip key={l} on={rich === v} onClick={() => set({ rich: v })}>{l}</Chip>))}
        </ParamRow>
        <ParamRow label="AVOID" last>
          {AVOIDABLE.map(a => (
            <Chip key={a} on={avoid.includes(a)} onClick={() => set({ avoid: toggle(avoid, a) })}>{a}</Chip>))}
        </ParamRow>
      </div>
    </details>
  )
}

function ParamRow({ label, children, last }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: last ? 0 : 11 }}>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#6b675f', flex: 'none', width: 74 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="mono" aria-pressed={on}
      style={{ background: on ? 'var(--accent)' : 'transparent', color: on ? '#0a0a0a' : 'var(--dim)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), borderRadius: 2, padding: '5px 11px', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {children}
    </button>
  )
}
