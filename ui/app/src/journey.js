// Shared vocabulary of the search journey: stage labels, filter summary, user notices.
import { LIVE_URL } from './api.js'

export const LOG = {
  parse: 'PARSING CRAVING',
  axes: 'PLOTTING SENSORY COORDINATES',
  excl: 'REMOVING EXCLUDED DISHES',
  rank: 'SELECTING DESTINATIONS',
}

export const excludedCount = r => r.excluded_count ?? (r.excluded || []).length

// One line per active filter, shown in the summary, the progress log and the results header.
export function describeFilters({ cuisines, spice, rich, avoid }) {
  return [...cuisines, spice && 'spice:' + spice, rich && 'rich:' + rich, ...avoid.map(a => 'no ' + a)].filter(Boolean)
}

export const PUBLIC_NOTICE = `This is the public gallery — pick a craving below. The live version takes any craving, by invite at ${LIVE_URL.replace(/^https?:\/\//, '')}`
export const OFFLINE_NOTICE = 'PIPELINE OFFLINE. START ui/server.py'

