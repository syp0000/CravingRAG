import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// jsdom implements neither canvas drawing nor media playback. The Sky and Backdrop
// components call these on mount; a no-op context and resolved play() let the
// components' own logic (timers, refs, event wiring) run for real.
const noop2d = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} })
HTMLCanvasElement.prototype.getContext = () => noop2d
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
for (const m of ['play', 'pause', 'load']) {
  HTMLMediaElement.prototype[m] = vi.fn(() => (m === 'play' ? Promise.resolve() : undefined))
}
