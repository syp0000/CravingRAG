import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import Sky from './Sky.jsx'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const TOP = [{ recipe_id: 1, title: 'Kimchi Jjigae' }, { recipe_id: 2, title: 'A very long recipe title that keeps going' }]

describe('Sky', () => {
  it('is decorative and cleans up its frame loop and resize listener', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { container, unmount } = render(<Sky className="search-sky" />)
    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    expect(canvas).toHaveClass('search-sky')
    expect(canvas).toHaveTextContent('Decorative star field')
    unmount()
    expect(cancel).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('arrive() places the picks on the left half, staggered, and reset() clears them', () => {
    const ref = createRef()
    render(<Sky ref={ref} />)
    const pts = ref.current.arrive(TOP)
    expect(pts).toHaveLength(2)
    for (const p of pts) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(0.55); expect(p.alpha).toBe(0) }
    expect(pts[1].label).toMatch(/…$/)
    expect(pts[1].label.length).toBe(24)
    expect(pts.map(p => p.rank)).toEqual([0, 1])
    // deterministic: same picks, same coordinates
    expect(ref.current.arrive(TOP)).toEqual(pts)
    vi.advanceTimersByTime(300 * TOP.length + 400)   // the rAF loop never drains; step past the stagger only
    ref.current.reset()
    expect(ref.current.arrive([TOP[0]])).toHaveLength(1)
  })
})
