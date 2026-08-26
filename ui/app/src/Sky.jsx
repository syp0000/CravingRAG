import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// Scene canvas: landing = twinkling field with parallax; voyage = warp streaks,
// jettisoned cargo, then five contact stars. Canvas because every frame moves everything.
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4)
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15)
  return (n >>> 0) / 4294967295
}

const Sky = forwardRef(function Sky({ parallax }, ref) {
  const canvasRef = useRef(null)
  const stars = useRef([])
  const debris = useRef([])        // jettisoned cargo: {x,y,vx,vy,label,life}
  const contacts = useRef([])      // arrival stars: {x,y,rank,label,alpha}
  const ribbon = useRef(0)         // 0..1 draw progress
  const vel = useRef({ v: 0, target: 0 })
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
    resize(); addEventListener('resize', () => { resize(); paintNebula() })

    // 1100 field stars, depth banded, Hubble palette: blue-white clusters,
    // warm whites, sparse amber giants
    const TINTS = [[188,210,255],[236,233,226],[236,233,226],[255,196,140],[255,138,79]]
    stars.current = Array.from({ length: 1100 }, (_, i) => {
      const t = TINTS[Math.floor(hash(i * 41 + 3) * (hash(i*17)>0.85 ? 5 : 3))]
      return {
        x: hash(i * 7 + 1), y: hash(i * 13 + 5),
        z: 0.25 + hash(i * 31 + 9) * 0.75,
        tw: hash(i * 3) * Math.PI * 2, tint: t,
      }
    })

    // nebula haze painted once to an offscreen layer: deep blue arms, one warm core
    const neb = document.createElement('canvas')
    const paintNebula = () => {
      neb.width = W; neb.height = Hh
      const nx = neb.getContext('2d')
      const blob = (x, y, r, stops) => {
        const g = nx.createRadialGradient(x, y, 0, x, y, r)
        stops.forEach(([o, c]) => g.addColorStop(o, c))
        nx.fillStyle = g; nx.fillRect(0, 0, W, Hh)
      }
      blob(W * 0.62, Hh * 0.38, Math.max(W, Hh) * 0.5,
        [[0, 'rgba(255,190,120,0.10)'], [0.25, 'rgba(255,150,80,0.05)'], [1, 'rgba(0,0,0,0)']])
      blob(W * 0.25, Hh * 0.7, Math.max(W, Hh) * 0.55,
        [[0, 'rgba(90,130,210,0.09)'], [1, 'rgba(0,0,0,0)']])
      blob(W * 0.85, Hh * 0.8, Math.max(W, Hh) * 0.4,
        [[0, 'rgba(120,110,200,0.07)'], [1, 'rgba(0,0,0,0)']])
      blob(W * 0.4, Hh * 0.15, Math.max(W, Hh) * 0.35,
        [[0, 'rgba(80,120,190,0.07)'], [1, 'rgba(0,0,0,0)']])
    }
    paintNebula()

    const spark = (x, y, r, color, glow) => {
      ctx.save()
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = r * 3 }
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
      ctx.drawImage(neb, 0, 0)
      const pv = par.current
      const off = typeof pv?.get === 'function' ? pv.get() : 0
      const V = vel.current
      V.v += (V.target - V.v) * 0.022

      // field
      for (const s of stars.current) {
        if (V.v > 0.01) { s.x -= V.v * 0.011 * s.z; if (s.x < -0.05) { s.x += 1.1; s.y = Math.random() } }
        const x = s.x * W, y = s.y * Hh + (V.v > 0.01 ? 0 : off * s.z * 0.2)
        const a = (0.25 + 0.6 * s.z) * (0.6 + 0.4 * Math.sin(t / 900 + s.tw))
        const [tr, tg, tb] = s.tint
        if (V.v > 0.05) {                        // warp streak
          const len = V.v * 90 * s.z
          ctx.strokeStyle = `rgba(${tr},${tg},${tb},${a * 0.8})`
          ctx.lineWidth = s.z * 1.5
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke()
        } else {
          ctx.fillStyle = `rgba(${tr},${tg},${tb},${a})`
          ctx.beginPath(); ctx.arc(x, y, 0.6 + s.z * 1.2, 0, 7); ctx.fill()
        }
      }

      // jettisoned cargo
      debris.current = debris.current.filter(d => d.life > 0)
      for (const d of debris.current) {
        d.x += d.vx; d.y += d.vy; d.life -= 0.008
        const a = Math.min(1, d.life * 2)
        spark(d.x * W, d.y * Hh, 4.5, `rgba(255,79,0,${a})`, d.life > 0.7)
        if (d.label) {
          ctx.save()
          ctx.font = '500 11px "IBM Plex Mono", Menlo, monospace'
          ctx.fillStyle = `rgba(255,110,60,${a})`
          ctx.fillText(('− ' + d.label).toUpperCase(), d.x * W + 10, d.y * Hh - 8)
          ctx.restore()
        }
      }

      // ribbon between contacts
      if (contacts.current.length > 1 && ribbon.current > 0) {
        ribbon.current = Math.min(1, ribbon.current + 0.012)
        const pts = contacts.current
        const total = (pts.length - 1) * ribbon.current
        ctx.save()
        ctx.strokeStyle = 'rgba(255,79,0,.55)'
        ctx.setLineDash([2, 9]); ctx.lineWidth = 1.5; ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0].x * W, pts[0].y * Hh)
        for (let i = 1; i < pts.length; i++) {
          const seg = Math.min(1, Math.max(0, total - (i - 1)))
          if (seg <= 0) break
          const a = pts[i - 1], b = pts[i]
          ctx.lineTo((a.x + (b.x - a.x) * seg) * W, (a.y + (b.y - a.y) * seg) * Hh)
        }
        ctx.stroke(); ctx.restore()
      }

      // contact stars
      for (const c of contacts.current) {
        c.alpha = Math.min(1, c.alpha + 0.02)
        const x = c.x * W, y = c.y * Hh
        spark(x, y, (12 - c.rank * 1.2) * c.alpha, `rgba(244,241,232,${c.alpha})`, true)
        if (c.alpha > 0.6) {
          ctx.save()
          ctx.font = '600 13px "IBM Plex Mono", Menlo, monospace'
          ctx.fillStyle = `rgba(255,79,0,${c.alpha})`
          ctx.fillText(String(c.rank + 1).padStart(2, '0'), x + 20, y + 5)
          ctx.fillStyle = `rgba(236,233,226,${c.alpha})`
          ctx.fillText(c.label.toUpperCase(), x + 46, y + 5)
          ctx.restore()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize) }
  }, [])

  useImperativeHandle(ref, () => ({
    reset() { vel.current.target = 0; vel.current.v = 0; debris.current = []; contacts.current = []; ribbon.current = 0 },
    warp() { vel.current.target = 1 },
    cruise() { vel.current.target = 0.35 },
    jettison(excluded) {
      const n = Math.min(26, excluded.length)
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          debris.current.push({
            x: 0.25 + Math.random() * 0.45, y: 0.12 + Math.random() * 0.75,
            vx: -(0.004 + Math.random() * 0.005), vy: (Math.random() - 0.5) * 0.002,
            label: i < 6 ? excluded[i].matched : null, life: 1,
          })
        }, i * 90)
      }
    },
    arrive(top) {
      vel.current.target = 0
      const seed = top.reduce((a, d) => a + d.recipe_id, 0)
      const jit = (k, lo, hi) => lo + (hi - lo) * hash(seed * 13 + k * 7)
      // contacts spread ahead of the ship (ship sits ~18% from the left)
      const pts = top.map((d, i) => ({
        x: 0.3 + (i / Math.max(1, top.length - 1)) * 0.4 + jit(i, -0.03, 0.03),
        y: 0.2 + jit(i + 9, 0, 0.45) + (i % 2) * 0.12,
        rank: i, alpha: 0,
        label: d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title,
      }))
      pts.forEach((p, i) => setTimeout(() => { contacts.current.push(p) }, 350 * i))
      setTimeout(() => { ribbon.current = 0.01 }, 350 * top.length + 300)
      return pts
    },
    contactPoints() { return contacts.current },
  }))

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
})

export default Sky
