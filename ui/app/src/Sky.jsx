import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// Canvas starfield — one star per rendered dish. Canvas, not SVG/DOM: the death and
// constellation phases repaint hundreds of stars per frame.
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4)
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15)
  return (n >>> 0) / 4294967295
}

const Sky = forwardRef(function Sky({ parallax }, ref) {
  // parallax is a framer MotionValue — read inside the rAF loop, never through React state
  const canvasRef = useRef(null)
  const stars = useRef([])          // {id,x,y,r,tw,mode,alpha,color,tx,ty,label}
  const ribbon = useRef([])         // constellation line points
  const par = useRef(parallax)
  par.current = parallax

  useEffect(() => {
    const cv = canvasRef.current
    const ctx = cv.getContext('2d')
    let raf, W, Hh
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const resize = () => {
      W = innerWidth; Hh = innerHeight
      cv.width = W * dpr; cv.height = Hh * dpr
      cv.style.width = W + 'px'; cv.style.height = Hh + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize(); addEventListener('resize', resize)

    fetch('/catalog').then(r => r.json()).then(cat => {
      const p = Math.min(1, 1100 / cat.length)
      stars.current = cat.filter(d => hash(d.recipe_id * 17 + 5) <= p).map(d => ({
        id: d.recipe_id, title: d.title,
        x: 0.03 + hash(d.recipe_id) * 0.94,
        y: 0.04 + hash(d.recipe_id * 7 + 13) * 0.92,
        r: hash(d.recipe_id * 31) > 0.85 ? 2.6 : 1.4,
        tw: hash(d.recipe_id * 3) * Math.PI * 2,
        mode: 'idle', alpha: 1, prog: 0, label: null,
      }))
      window.__skyCount = cat.length
      window.__stars = () => stars.current
    }).catch(() => {})

    const spark = (x, y, r, color, glow) => {
      ctx.save()
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = r * 3.2 }
      ctx.fillStyle = color
      ctx.beginPath()
      const q = r * 0.36
      ctx.moveTo(x, y - r)
      ctx.bezierCurveTo(x + q, y - q, x + q, y - q, x + r, y)
      ctx.bezierCurveTo(x + q, y + q, x + q, y + q, x, y + r)
      ctx.bezierCurveTo(x - q, y + q, x - q, y + q, x - r, y)
      ctx.bezierCurveTo(x - q, y - q, x - q, y - q, x, y - r)
      ctx.fill(); ctx.restore()
    }

    const loop = (t) => {
      ctx.clearRect(0, 0, W, Hh)
      const pv = par.current
      const off = typeof pv?.get === 'function' ? pv.get() : (pv || 0)
      // ribbon under the stars
      if (ribbon.current.length > 1) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255,79,0,.55)'
        ctx.setLineDash([2, 9]); ctx.lineWidth = 1.6; ctx.lineCap = 'round'
        ctx.beginPath()
        ribbon.current.forEach(([rx, ry], i) => {
          const px = rx * W, py = ry * Hh + off * 0.15
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
        })
        ctx.stroke(); ctx.restore()
      }
      for (const s of stars.current) {
        const depth = s.r > 2 ? 0.22 : 0.12
        let x = s.x * W, y = s.y * Hh + off * depth
        if (s.mode === 'top') {
          s.prog = Math.min(1, s.prog + 0.03)
          const e = 1 - Math.pow(1 - s.prog, 3)
          x = (s.x + (s.tx - s.x) * e) * W
          y = (s.y + (s.ty - s.y) * e) * Hh + off * 0.15
          spark(x, y, 12 - s.rank * 1.3, '#f4f1e8', true)
          if (s.prog > 0.85 && s.label) {
            ctx.save()
            ctx.font = '600 13px "IBM Plex Mono", Menlo, monospace'
            ctx.fillStyle = 'rgba(255,79,0,.95)'
            ctx.fillText(String(s.rank + 1).padStart(2,'0'), x + 20, y + 5)
            ctx.fillStyle = 'rgba(236,233,226,.95)'
            ctx.fillText(s.label.toUpperCase(), x + 46, y + 5)
            ctx.restore()
          }
          continue
        }
        if (s.mode === 'dead') {
          s.prog = Math.min(1, s.prog + 0.012)
          const a = s.prog < 0.25 ? 1 : Math.max(0.04, 1 - (s.prog - 0.25) / 0.6)
          spark(x, y, s.r + 1.6, `rgba(255,79,0,${a})`, s.prog < 0.4)
          if (s.label && s.prog < 0.45) {
            ctx.save()
            ctx.font = '500 11px "IBM Plex Mono", Menlo, monospace'
            ctx.fillStyle = `rgba(255,110,60,${1 - s.prog * 2})`
            ctx.fillText(('− ' + s.label).toUpperCase(), x + 8, y - 8)
            ctx.restore()
          }
          continue
        }
        const twk = 0.55 + 0.45 * Math.sin(t / 900 + s.tw)
        const a = (s.mode === 'dim' ? 0.16 : 0.85) * twk * s.alpha
        if (s.r > 2) spark(x, y, s.r + 1.2, `rgba(240,236,226,${a})`, false)
        else {
          ctx.fillStyle = `rgba(224,220,210,${a})`
          ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize) }
  }, [])

  useImperativeHandle(ref, () => ({
    reset() {
      ribbon.current = []
      stars.current.forEach(s => { s.mode = 'idle'; s.prog = 0; s.label = null })
    },
    kill(excluded) {           // [{recipe_id, matched}]
      const byId = new Map(excluded.map(e => [e.recipe_id, e.matched]))
      let shown = 0
      stars.current.forEach((s, i) => {
        if (!byId.has(s.id)) return
        setTimeout(() => {
          s.mode = 'dead'; s.prog = 0
          if (shown < 6) { s.label = byId.get(s.id); shown++ }
        }, (i % 40) * 60)
      })
    },
    dimRest() {
      stars.current.forEach(s => { if (s.mode === 'idle') s.mode = 'dim' })
    },
    constellation(top) {       // [{recipe_id, title}]
      const cx = 0.42, cy = 0.5, R = 0.3
      const seed = top.reduce((a, d) => a + d.recipe_id, 0)
      const jit = (k, lo, hi) => lo + (hi - lo) * hash(seed * 13 + k * 7)
      const pts = top.map((d, i) => {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 5) + jit(i, -1, 1) * 0.5
        const r = R * jit(i + 9, 0.55, 1.1)
        return [cx + r * Math.cos(a) * 0.9, cy + r * Math.sin(a)]
      })
      top.forEach((d, i) => {
        let s = stars.current.find(x => x.id === d.recipe_id)
        if (!s) { s = { id: d.recipe_id, x: pts[i][0], y: pts[i][1], r: 2.6, tw: 0, alpha: 1 }; stars.current.push(s) }
        s.mode = 'top'; s.prog = 0; s.rank = i
        s.tx = pts[i][0]; s.ty = pts[i][1]
        s.label = d.title.length > 26 ? d.title.slice(0, 25) + '…' : d.title
      })
      setTimeout(() => { ribbon.current = pts }, 700)
    },
  }))

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
})

export default Sky
