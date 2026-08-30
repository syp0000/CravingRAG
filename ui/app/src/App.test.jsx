// Behaviour tests for the search journey. Footage, the canvas sky and the network are
// mocked; the GSAP timelines in Search.jsx run for real against jsdom.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { useEffect } from 'react'

const api = vi.hoisted(() => ({
  IS_PUBLIC: false,
  LIVE_URL: 'https://app.cravingrag.com',
  searchLive: vi.fn(),
  loadGallery: vi.fn(),
  gapsApi: vi.fn(),
}))
vi.mock('./api.js', () => api)
// GSAP's intro tweens park elements at visibility:hidden in jsdom; the timelines are
// not under test here, the state machine and markup are.
vi.mock('@gsap/react', () => ({ useGSAP: () => {} }))
vi.mock('./Sky.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef(function Sky(_, ref) { useImperativeHandle(ref, () => ({ reset() {} })); return <div data-testid="sky" /> }) }
})
vi.mock('./Backdrop.jsx', () => ({
  // the real footage takes ~6s to reach the stars; here the journey completes at once
  SingleAstronautBackdrop: ({ departing, onComplete }) => {
    useEffect(() => { if (departing) onComplete?.() }, [departing, onComplete])
    return <div data-testid="backdrop" />
  },
  CinematicBackdrop: () => <div data-testid="milkyway" />,
}))
vi.mock('./About.jsx', () => ({ default: () => <h1>About page</h1> }))
vi.mock('./Catalog.jsx', () => ({ default: () => <h1>Catalog page</h1> }))

import App from './App.jsx'

const RESULT = {
  query: 'spicy soup', concepts: ['spicy'], excludes: [], excluded_count: 0, candidate_count: 40,
  interpretation: { required_identity: ['soup'], drink_allowed: false, requested_components: [] },
  decision_id: 'recommendation:abc',
  top: [
    { recipe_id: 1, title: 'Kimchi Jjigae', sim: 0.81, edges: [{ axis: 'spicy', value: 0.9, target: 0.8, evidence: ['gochugaru heat'] }],
      ingredients: ['kimchi', 'tofu'], directions: ['boil'] },
    { recipe_id: 2, title: 'Tom Yum', sim: 0.77, edges: [], ingredients: [], directions: [] },
  ],
}
const JOURNEY = { timeout: 6000 }   // 900 + 300·n + 200 ms of staged sleeps

// a closed <details> keeps its chips out of the accessibility tree
const openFilters = () => { screen.getByText('FINE-TUNE YOUR SEARCH').closest('details').open = true }

async function submit(text) {
  fireEvent.change(screen.getByLabelText('craving'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'SEARCH' }))
}

beforeEach(() => {
  api.IS_PUBLIC = false
  api.searchLive.mockReset()
  api.loadGallery.mockReset()
  location.hash = ''
})

describe('navigation', () => {
  it('switches pages on hash change and marks the current link', async () => {
    render(<App />)
    expect(screen.getByRole('link', { name: 'SEARCH' })).toHaveAttribute('aria-current', 'page')
    await act(async () => { location.hash = '#about'; dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(screen.getByRole('heading', { name: 'About page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ABOUT' })).toHaveAttribute('aria-current', 'page')
    await act(async () => { location.hash = '#catalog'; dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(screen.getByRole('heading', { name: 'Catalog page' })).toBeInTheDocument()
  })

  it('exposes accessible names for the important controls', () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CravingRAG home' })).toHaveAttribute('href', '#search')
    expect(screen.getByRole('form', { name: 'Craving search' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'craving' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SEARCH' })).toHaveAttribute('type', 'submit')
    openFilters()
    expect(screen.getByRole('button', { name: 'korean', pressed: false })).toBeInTheDocument()
  })
})

describe('search', () => {
  it('submits the query with the chosen filters', async () => {
    api.searchLive.mockResolvedValue(RESULT)
    render(<App />)
    openFilters()
    fireEvent.click(screen.getByRole('button', { name: 'korean' }))
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    fireEvent.click(screen.getByRole('button', { name: 'shellfish' }))
    expect(screen.getByRole('button', { name: 'korean' })).toHaveAttribute('aria-pressed', 'true')
    await submit('spicy soup')
    expect(api.searchLive).toHaveBeenCalledWith('spicy soup', { cuisines: ['korean'], spice: 'fire', rich: '', avoid: ['shellfish'] })
    expect(await screen.findByText(/PLOTTING SENSORY COORDINATES/)).toBeInTheDocument()
    expect(screen.getByText(/KOREAN \/ SPICE:FIRE \/ NO SHELLFISH/)).toBeInTheDocument()
  })

  it('ignores an empty query', async () => {
    render(<App />)
    await submit('   ')
    expect(api.searchLive).not.toHaveBeenCalled()
    expect(screen.queryByText('PARSING CRAVING')).not.toBeInTheDocument()
  })

  it('renders the ranked results and the interpretation', async () => {
    api.searchLive.mockResolvedValue(RESULT)
    render(<App />)
    await submit('spicy soup')
    expect(await screen.findByText(/SEARCH COMPLETE · 2 MATCHES/, {}, JOURNEY)).toBeInTheDocument()
    const rows = within(screen.getByLabelText('Ranked recipe results')).getAllByRole('button')
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Kimchi Jjigae'), expect.stringContaining('Tom Yum')])
    expect(rows[1]).toHaveTextContent('PROFILE SIMILARITY MATCH')
    expect(screen.getByText(/INTERPRETED AS · FOOD · SOUP/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'WHY ↗' })).toHaveAttribute('href', '/why?id=recommendation:abc')
  })

  it('opens the recipe detail for a picked result', async () => {
    api.searchLive.mockResolvedValue(RESULT)
    render(<App />)
    await submit('spicy soup')
    fireEvent.click(await screen.findByRole('button', { name: /Tom Yum/ }, JOURNEY))
    const panel = screen.getByRole('complementary', { name: 'Recipe detail' })
    expect(panel).toHaveClass('panel--open')
    expect(panel).toHaveTextContent('02 · SIMILARITY 0.77')
    expect(panel).toHaveTextContent('No sensory axis covers this craving')
    fireEvent.click(screen.getByRole('button', { name: '← RESULTS' }))
    expect(panel).not.toHaveClass('panel--open')
    fireEvent.click(screen.getByRole('button', { name: /Kimchi Jjigae/ }))
    expect(panel).toHaveTextContent('“gochugaru heat”')
    expect(panel).toHaveTextContent('kimchi')
  })

  it('explains an empty result instead of padding', async () => {
    api.searchLive.mockResolvedValue({ ...RESULT, top: [], excluded_count: 3 })
    render(<App />)
    await submit('unicorn soup')
    expect(await screen.findByText(/REMOVING EXCLUDED DISHES/)).toBeInTheDocument()
    expect(await screen.findByText(/0 MATCHES/, {}, JOURNEY)).toBeInTheDocument()
    expect(screen.getByText(/showing none rather than padding/)).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('shows API errors and returns to the form', async () => {
    api.searchLive.mockResolvedValue({ error: 'internal error' })
    render(<App />)
    await submit('spicy soup')
    expect(await screen.findByRole('alert')).toHaveTextContent('internal error')
    expect(screen.getByRole('button', { name: 'SEARCH' })).toBeEnabled()
  })

  it('reports an unreachable pipeline', async () => {
    api.searchLive.mockRejectedValue(new TypeError('fetch failed'))
    render(<App />)
    await submit('spicy soup')
    expect(await screen.findByRole('alert')).toHaveTextContent('PIPELINE OFFLINE')
  })
})

describe('public gallery', () => {
  beforeEach(() => {
    api.IS_PUBLIC = true
    api.loadGallery.mockResolvedValue([{ label: 'a warm spicy soup', q: 'spicy soup', params: { cuisines: ['korean'] }, result: RESULT }])
  })

  it('refuses free text and points at the live app', async () => {
    render(<App />)
    await submit('anything')
    expect(await screen.findByRole('alert')).toHaveTextContent(/public gallery.*app.cravingrag.com/)
    expect(api.searchLive).not.toHaveBeenCalled()
  })

  it('replays a precomputed craving without touching the network', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'a warm spicy soup' }))
    expect(await screen.findByText(/SEARCH COMPLETE · 2 MATCHES/, {}, JOURNEY)).toBeInTheDocument()
    expect(screen.getByText('KOREAN')).toBeInTheDocument()
    expect(api.searchLive).not.toHaveBeenCalled()
  })
})
