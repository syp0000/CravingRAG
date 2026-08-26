import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// Calm star field. Landing/search: slow twinkle only. After a search: the excluded
// count dims a handful of stars, the five picks bloom with labels and a dotted ribbon.
// Canvas because 1100 points twinkle every frame; nothing here streaks or flies.
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4)
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15)
  return (n >>> 0) / 4294967295
}

const Sky = forwardRef(function Sky({ dimmed = false }, ref) {
  const canvasRef = useRef(null)
  const stars = useRef([])
  const contacts = useRef([])      // {x,y,rank,label,alpha}
  const ribbon = useRef(0)
  const dim = useRef(dimmed)
  dim.current = dimmed

  useEffect(() => {
    const cv = canvasRef.current
    const ctx = cv.getContext('2d')
    let raf, W, Hh
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => {
      W = innerWidth; Hh = innerHeight
      cv.width = W * dpr; cv.height = Hh * dpr
      cv.style.width = W + 'px'; cv.style.height = Hh + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paintNebula()
    }
    const TINTS = [[188, 210, 255], [236, 233, 226], [236, 233, 226], [255, 196, 140], [255, 138, 79]]
    stars.current = Array.from({ length: 900 }, (_, i) => ({
      x: hash(i * 7 + 1), y: hash(i * 13 + 5),
      z: 0.25 + hash(i * 31 + 9) * 0.75,
      tw: hash(i * 3) * Math.PI * 2,
      tint: TINTS[Math.floor(hash(i * 41 + 3) * (hash(i * 17) > 0.85 ? 5 : 3))],
    }))

    const neb = document.createElement('canvas')
    const paintNebula = () => {
      neb.width = W; neb.height = Hh
      const nx = neb.getContext('2d')
      const blob = (x, y, r, stops) => {
        const g = nx.createRadialGradient(x, y, 0, x, y, r)
        stops.forEach(([o, c]) => g.addColorStop(o, c))
        nx.fillStyle = g; nx.fillRect(0, 0, W, Hh)
      }
      blob(W * 0.62, Hh * 0.38, Math.max(W, Hh) * 0.5, [[0, 'rgba(255,190,120,0.08)'], [1, 'rgba(0,0,0,0)']])
      blob(W * 0.25, Hh * 0.7, Math.max(W, Hh) * 0.55, [[0, 'rgba(90,130,210,0.08)'], [1, 'rgba(0,0,0,0)']])
    }
    resize(); addEventListener('resize', resize)

    const spark = (x, y, r, color) => {
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = r * 2.5; ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 7); ctx.fill(); ctx.restore()
    }

    const loop = (t) => {
      ctx.clearRect(0, 0, W, Hh)
      ctx.drawImage(neb, 0, 0)
      const fade = dim.current ? 0.45 : 1
      for (const s of stars.current) {
        const a = fade * (0.2 + 0.55 * s.z) * (reduced ? 0.8 : 0.65 + 0.35 * Math.sin(t / 1400 + s.tw))
        const [r, g, b] = s.tint
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        ctx.beginPath(); ctx.arc(s.x * W, s.y * Hh, 0.6 + s.z * 1.1, 0, 7); ctx.fill()
      }
      if (contacts.current.length > 1 && ribbon.current > 0) {
        ribbon.current = Math.min(1, ribbon.current + 0.012)
        const pts = contacts.current, total = (pts.length - 1) * ribbon.current
        ctx.save(); ctx.strokeStyle = 'rgba(255,79,0,.5)'; ctx.setLineDash([2, 9]); ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(pts[0].x * W, pts[0].y * Hh)
        for (let i = 1; i < pts.length; i++) {
          const seg = Math.min(1, Math.max(0, total - (i - 1)))
          if (seg <= 0) break
          const a = pts[i - 1], b = pts[i]
          ctx.lineTo((a.x + (b.x - a.x) * seg) * W, (a.y + (b.y - a.y) * seg) * Hh)
        }
        ctx.stroke(); ctx.restore()
      }
      for (const c of contacts.current) {
        c.alpha = Math.min(1, c.alpha + 0.02)
        const x = c.x * W, y = c.y * Hh
        spark(x, y, (12 - c.rank * 1.2) * c.alpha, `rgba(244,241,232,${c.alpha})`)
        if (c.alpha > 0.6) {
          ctx.save(); ctx.font = '600 13px "IBM Plex Mono", Menlo, monospace'
          ctx.fillStyle = `rgba(255,79,0,${c.alpha})`; ctx.fillText(String(c.rank + 1).padStart(2, '0'), x + 18, y + 5)
          ctx.fillStyle = `rgba(236,233,226,${c.alpha})`; ctx.fillText(c.label.toUpperCase(), x + 44, y + 5)
          ctx.restore()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize) }
  }, [])

  useImperativeHandle(ref, () => ({
    reset() { contacts.current = []; ribbon.current = 0 },
    arrive(top) {
      const seed = top.reduce((a, d) => a + d.recipe_id, 0)
      const jit = (k, lo, hi) => lo + (hi - lo) * hash(seed * 13 + k * 7)
      // picks spread over the left 55% of the screen; the results panel owns the right
      const pts = top.map((d, i) => ({
        x: 0.08 + (i / Math.max(1, top.length - 1)) * 0.42 + jit(i, -0.02, 0.02),
        y: 0.22 + jit(i + 9, 0, 0.5) + (i % 2) * 0.1,
        rank: i, alpha: 0,
        label: d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title,
      }))
      pts.forEach((p, i) => setTimeout(() => { contacts.current.push(p) }, 300 * i))
      setTimeout(() => { ribbon.current = 0.01 }, 300 * top.length + 300)
      return pts
    },
  }))

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
})

export default Sky
