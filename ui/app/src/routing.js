import { useEffect, useState } from 'react'

// Hash routing: #about, #catalog, anything else is the search page.
const PAGES = { '#about': 'about', '#catalog': 'catalog' }
export const readPage = () => PAGES[location.hash] || 'search'

export function usePage() {
  const [page, setPage] = useState(readPage)
  useEffect(() => {
    const on = () => { setPage(readPage()); scrollTo(0, 0) }
    addEventListener('hashchange', on); return () => removeEventListener('hashchange', on)
  }, [])
  return page
}
