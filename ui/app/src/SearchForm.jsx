import { IS_PUBLIC } from './api.js'

export default function SearchForm({ query, onQueryChange, onSubmit, busy, error, gallery, onPickPreset }) {
  return (
    <>
      <form onSubmit={onSubmit} className="search-bar liquid-glass" aria-label="Craving search">
        <input value={query} onChange={e => onQueryChange(e.target.value)} placeholder="a warm spicy soup, no shellfish" aria-label="craving"
          className="query-input" />
        <button type="submit" className="search-button mono" disabled={busy}>
          <span>{busy ? 'WORKING' : 'SEARCH'}</span><span aria-hidden="true">↗</span>
        </button>
      </form>
      {error && <p role="alert" className="mono" style={{ color: 'var(--accent)', marginTop: 14, fontSize: 13 }}>{error}</p>}

      {IS_PUBLIC && gallery.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.18em', color: '#6b675f', marginBottom: 9 }}>TRY A CRAVING</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }} aria-label="Precomputed cravings">
            {gallery.map(g => (
              <button key={g.q} type="button" onClick={() => onPickPreset(g)} disabled={busy} className="mono"
                style={{ background: 'transparent', color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 2,
                  padding: '7px 12px', fontSize: 12, letterSpacing: '0.02em', cursor: 'pointer', textAlign: 'left' }}>
                {g.label}
              </button>))}
          </div>
        </div>
      )}
    </>
  )
}
