// One place that decides live backend vs precomputed static gallery.
// The public build (VITE_PUBLIC_GALLERY=1, deployed to the open root domain) reads
// bundled JSON and never touches Snowflake, so it costs nothing per view. The live
// build calls the real endpoints behind Cloudflare Access.
export const IS_PUBLIC = import.meta.env.VITE_PUBLIC_GALLERY === '1'
export const LIVE_URL = import.meta.env.VITE_LIVE_URL || 'https://app.cravingrag.com'

let _gallery
export function loadGallery() {
  if (!_gallery) _gallery = fetch('/gallery.json').then(r => r.json()).catch(() => [])
  return _gallery
}

// Live free-text search: the real pipeline. Only reachable in the live build.
export function searchLive(q, params = {}) {
  const ps = new URLSearchParams({ q })
  if (params.cuisines?.length) ps.set('cuisine', params.cuisines.join(','))
  if (params.avoid?.length) ps.set('avoid', params.avoid.join(','))
  if (params.spice) ps.set('spice', params.spice)
  if (params.rich) ps.set('rich', params.rich)
  return fetch('/search?' + ps).then(r => r.json())
}

// Catalog page: live mart vs the precomputed snapshot.
export function gapsApi() {
  return fetch(IS_PUBLIC ? '/gaps.json' : '/gaps').then(r => r.json())
}
