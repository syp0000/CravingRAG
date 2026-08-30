import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// the scroll-reveal tweens park sections at visibility:hidden in jsdom
vi.mock('@gsap/react', () => ({ useGSAP: () => {} }))
import About from './About.jsx'

describe('About', () => {
  it('embeds the pipeline diagram and links to the catalog', () => {
    render(<About />)
    const frame = screen.getByTitle('CravingRAG pipeline')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', expect.stringMatching(/^\/diagrams\/craving-pipeline\.html/))
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '#catalog')
  })

  it('states the limits alongside the claims', () => {
    render(<About />)
    expect(screen.getByText(/It never makes them up/)).toBeInTheDocument()
    expect(screen.getByText(/leaves room for error/)).toBeInTheDocument()
  })
})
