// Top navigation. Page state comes from routing.js.
const LINKS = [['search', '#search', 'SEARCH'], ['catalog', '#catalog', 'CATALOG'], ['about', '#about', 'ABOUT']]

export function TopNav({ page }) {
  return (
    <nav className="top-nav liquid-glass mono" aria-label="Primary">
      <a href="#search" className="brand" aria-label="CravingRAG home"><span className="brand-mark" />CRAVINGRAG</a>
      <span className="nav-links">
        {LINKS.map(([key, href, label]) => (
          <a key={key} href={href} className="navlink" aria-current={page === key ? 'page' : undefined}>{label}</a>))}
      </span>
    </nav>
  )
}
