import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import gsap from 'gsap'
import { CinematicBackdrop, SingleAstronautBackdrop } from './Backdrop.jsx'

// which <video> elements have had play() called on them so far
const played = () => HTMLMediaElement.prototype.play.mock.contexts

afterEach(() => { gsap.globalTimeline.timeScale(1); vi.clearAllMocks() })

describe('CinematicBackdrop', () => {
  it('renders the Milky Way loop as two stacked copies, hidden from assistive tech', () => {
    const { container } = render(<CinematicBackdrop variant="about" />)
    const root = container.firstChild
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root).toHaveClass('cinematic-backdrop--about')
    const sources = [...container.querySelectorAll('video source')].map(s => s.getAttribute('src'))
    expect(sources).toEqual(['/media/about-milkyway.mp4', '/media/about-milkyway.mp4'])
  })
})

describe('SingleAstronautBackdrop', () => {
  it('idles on the forward clip and preloads the others', () => {
    const { container } = render(<SingleAstronautBackdrop departing={false} resultsVisible={false} />)
    const [fwd, rev, drift] = container.querySelectorAll('video')
    expect(fwd.playbackRate).toBe(0.9)
    expect(played()).toContain(fwd)
    expect(played()).not.toContain(rev)
    expect(played()).not.toContain(drift)
    expect(HTMLMediaElement.prototype.load.mock.contexts).toEqual([rev, drift])
    expect(rev.querySelector('source')).toHaveAttribute('src', '/media/search-departure-reverse.mp4')
    expect(drift.querySelector('source')).toHaveAttribute('src', '/media/search-drift.mp4')
    expect(container.querySelectorAll('.destination-star')).toHaveLength(5)
  })

  it('on departure plays the drift clip slower and reports completion once the stars are in', async () => {
    gsap.globalTimeline.timeScale(400)    // ~7.6s of footage handoff in a few frames
    const onComplete = vi.fn()
    const { container, rerender } = render(<SingleAstronautBackdrop departing={false} resultsVisible={false} onComplete={onComplete} />)
    rerender(<SingleAstronautBackdrop departing resultsVisible={false} onComplete={onComplete} />)
    const drift = container.querySelectorAll('video')[2]
    expect(drift.playbackRate).toBe(0.7)
    expect(played()).toContain(drift)
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 4000 })
    // a second departure after the stars are already in completes immediately
    rerender(<SingleAstronautBackdrop departing={false} resultsVisible onComplete={onComplete} />)
    rerender(<SingleAstronautBackdrop departing resultsVisible onComplete={onComplete} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2))
  })
})
