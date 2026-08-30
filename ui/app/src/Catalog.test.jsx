import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const api = vi.hoisted(() => ({ IS_PUBLIC: false, gapsApi: vi.fn() }))
vi.mock('./api.js', () => api)
import Catalog from './Catalog.jsx'

const gap = (scenario_id, intent_key, demand, supply, dishes, opp) => ({
  scenario_id, intent_key, demand_share: demand, supply_share: supply, matching_dishes: dishes,
  opportunity_index: opp, generator_version: '1', seed: 7 })
const DATA = {
  gaps: [gap('phoenix_summer', 'fresh_spicy', 0.31, 0.009, 3, 34.4), gap('phoenix_summer', 'warm', 0.2, 0.4, 140, 0.5),
         gap('baseline', 'comforting', 0.5, 0.3, 100, 1.7)],
  intents: [{ intent_key: 'fresh_spicy', target_axes: {}, matching_dishes: 3, catalog_size: 342 }],
  live: { searches: 12, min_candidates: 4, avg_candidates: 40 },
}

beforeEach(() => { api.gapsApi.mockReset() })

describe('Catalog', () => {
  it('shows a loading line until the mart answers', () => {
    api.gapsApi.mockReturnValue(new Promise(() => {}))
    render(<Catalog />)
    expect(screen.getByText('LOADING SNOWFLAKE MART')).toBeInTheDocument()
  })

  it('reports an API error', async () => {
    api.gapsApi.mockResolvedValue({ error: 'internal error' })
    render(<Catalog />)
    expect(await screen.findByRole('alert')).toHaveTextContent('internal error')
  })

  it('reports an unreachable server', async () => {
    api.gapsApi.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    render(<Catalog />)
    expect(await screen.findByRole('alert')).toHaveTextContent('PIPELINE OFFLINE')
  })

  it('renders the default scenario: decision card, ranked table, live count', async () => {
    api.gapsApi.mockResolvedValue(DATA)
    render(<Catalog />)
    expect(await screen.findByRole('heading', { level: 2, name: 'fresh + spicy' })).toBeInTheDocument()
    expect(screen.getByText(/31\.0% of searches in this scenario, 0\.90% of the catalog/)).toBeInTheDocument()
    expect(screen.getByText(/\(3 of 342 dishes\)/)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /Hot summer scenario/ })
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['intent', 'demand', 'supply', 'dishes', 'opportunity'])
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)).toEqual(['fresh_spicy', 'warm'])
    expect(screen.getByText(/LIVE SEARCHES RECORDED SO FAR: 12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PHOENIX_SUMMER/, pressed: true })).toHaveAttribute('type', 'button')
  })

  it('switches scenario on a chip click', async () => {
    api.gapsApi.mockResolvedValue(DATA)
    render(<Catalog />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: /BASELINE/ }))
    expect(screen.getByRole('button', { name: /BASELINE/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'comforting' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(1)
    expect(screen.getByText(/Normal day\./)).toBeInTheDocument()
  })
})
