import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

// Cinematic backdrops. Two are in use: the astronaut story behind the search page and
// the seamless Milky Way loop behind About / Catalog. Timings live in the story objects.

const SINGLE_ASTRONAUT_STORY = {
  src: '/media/search-departure.mp4',            // platform → astronaut drifts out
  reverseSrc: '/media/search-departure-reverse.mp4', // same clip reversed (ffmpeg -vf reverse)
  poster: '/media/search-departure-poster.png',
  driftSrc: '/media/search-drift.mp4',           // SEARCH: astronaut recedes into deep space (5.6s)
  idleRate: 0.9,
  loopFrom: 4.2,        // idle loop: full clip once, then float between loopFrom and the end
  driftRate: 0.7,       // the departure plays slower than real time
  crossfade: 0.7,       // idle clip → drift clip
  starsLead: 1.4,       // seconds before the drift clip ends that the star field starts fading in
  starsFade: 1.6,
}

const MOVING_STARFIELD = {
  src: '/media/results-gravity.mp4',
  poster: '/media/results-gravity-poster.png',
  playbackRate: 0.72,
  preload: 'auto',
  overlap: 1.4,
}

// Idle: the forward clip plays once in full (platform → out). Then only the floating
// part loops: the reversed clip plays from 0 back to loopFrom (never re-entering the
// station), the forward clip picks up at loopFrom and plays to the end, and so on.
// Browsers cannot play mp4 backwards, so the reverse is a real file, not a scrub.
// SEARCH: crossfade at once into the drift clip (astronaut receding into deep space);
// as it ends, the moving star field fades in over it. Only then does video stop.
export function SingleAstronautBackdrop({ departing, resultsVisible, onComplete }) {
  const root = useRef(null)
  const astronautLayer = useRef(null)
  const fwd = useRef(null)
  const rev = useRef(null)
  const driftLayer = useRef(null)
  const drift = useRef(null)
  const starfield = useRef(null)
  const departingRef = useRef(departing)
  const onCompleteRef = useRef(onComplete)
  const reachedStars = useRef(false)
  const handoff = useRef(null)
  const showing = useRef('fwd')

  useEffect(() => { departingRef.current = departing }, [departing])
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useGSAP((_, contextSafe) => {
    const F = fwd.current, R = rev.current
    const stars = starfield.current
    const rate = SINGLE_ASTRONAUT_STORY.idleRate
    F.defaultPlaybackRate = R.defaultPlaybackRate = rate
    F.playbackRate = R.playbackRate = rate

    const show = (which) => {
      showing.current = which
      gsap.set(F, { autoAlpha: which === 'fwd' ? 1 : 0 })
      gsap.set(R, { autoAlpha: which === 'rev' ? 1 : 0 })
    }
    // ping-pong over the floating part. Reverse time r == forward time (duration - r),
    // so "back to loopFrom" on the reversed clip is r >= duration - loopFrom.
    const { loopFrom } = SINGLE_ASTRONAUT_STORY
    const idle = () => !departingRef.current && !reachedStars.current
    // Forward ends → reverse starts at 0 (same frame). While reverse plays, the hidden
    // forward clip is already seeked to loopFrom, so the turn is a cut between two
    // ready frames, not a seek stall. rAF polling keeps the turn within one frame.
    let raf = 0
    const onFwdEnd = contextSafe(() => {
      if (!idle()) return
      R.currentTime = 0; R.play().catch(() => {}); show('rev')
      F.currentTime = loopFrom
    })
    const backToFloat = contextSafe(() => {
      if (!idle() || showing.current !== 'rev') return
      R.pause(); F.play().catch(() => {}); show('fwd')
    })
    const tick = () => {
      if (showing.current === 'rev' && !R.paused && R.currentTime >= (R.duration || 10) - loopFrom) backToFloat()
      raf = requestAnimationFrame(tick)
    }
    F.addEventListener('ended', onFwdEnd)
    R.addEventListener('ended', backToFloat)   // safety if a frame is dropped
    raf = requestAnimationFrame(tick)

    gsap.set(stars, { autoAlpha: 0 })
    gsap.set(driftLayer.current, { autoAlpha: 0 })
    show('fwd')
    F.play().catch(() => {})
    R.load()
    drift.current.load()

    return () => {
      cancelAnimationFrame(raf)
      F.removeEventListener('ended', onFwdEnd)
      R.removeEventListener('ended', backToFloat)
      handoff.current?.kill()
      F.pause(); R.pause(); drift.current.pause()
    }
  }, { scope: root })

  useGSAP((_, contextSafe) => {
    const F = fwd.current, R = rev.current, D = drift.current
    const { idleRate, driftRate, crossfade, starsLead, starsFade } = SINGLE_ASTRONAUT_STORY
    if (departing) {
      if (reachedStars.current) { contextSafe(() => onCompleteRef.current?.())(); return }
      D.currentTime = 0
      D.defaultPlaybackRate = driftRate; D.playbackRate = driftRate
      D.play().catch(() => {})
      const driftLen = Math.max(2, ((D.duration || 5.6) - starsLead) / driftRate)   // wall-clock seconds
      // the layers stack idle < drift < stars: fade only the upper one IN, then hide the
      // one below. Nothing is ever half-transparent over the poster.
      gsap.set(root.current, { backgroundImage: `url(${MOVING_STARFIELD.poster})` })
      handoff.current = gsap.timeline({
        defaults: { ease: 'sine.inOut' },
        onComplete: () => { D.pause(); reachedStars.current = true; if (departingRef.current) onCompleteRef.current?.() },
      })
        .to(driftLayer.current, { autoAlpha: 1, duration: crossfade }, 0)
        .call(() => { F.pause(); R.pause(); gsap.set(astronautLayer.current, { autoAlpha: 0 }) }, null, crossfade)
        .to(starfield.current, { autoAlpha: 1, duration: starsFade }, driftLen)
        .set(driftLayer.current, { autoAlpha: 0 }, driftLen + starsFade)
    } else {
      // back to the landing: kill the departure, resume the idle ping-pong from the platform
      handoff.current?.kill()
      reachedStars.current = false
      D.pause()
      F.playbackRate = idleRate
      F.currentTime = 0
      showing.current = 'fwd'
      gsap.set(R, { autoAlpha: 0 }); gsap.set(F, { autoAlpha: 1 })
      gsap.set(astronautLayer.current, { autoAlpha: 1 })
      gsap.set(driftLayer.current, { autoAlpha: 0 })
      gsap.set(starfield.current, { autoAlpha: 0 })
      gsap.set(root.current, { clearProps: 'backgroundImage' })
      F.play().catch(() => {})
    }
  }, { scope: root, dependencies: [departing] })

  return (
    <div ref={root} className={`cinematic-backdrop cinematic-backdrop--story ${resultsVisible ? 'cinematic-backdrop--story-results' : ''}`} aria-hidden="true">
      <div ref={astronautLayer} className="cinematic-single-video">
        <video ref={fwd} muted playsInline preload="auto" poster={SINGLE_ASTRONAUT_STORY.poster}>
          <source src={SINGLE_ASTRONAUT_STORY.src} type="video/mp4" />
        </video>
        <video ref={rev} muted playsInline preload="auto">
          <source src={SINGLE_ASTRONAUT_STORY.reverseSrc} type="video/mp4" />
        </video>
      </div>
      <div ref={driftLayer} className="cinematic-single-video">
        <video ref={drift} muted playsInline preload="auto">
          <source src={SINGLE_ASTRONAUT_STORY.driftSrc} type="video/mp4" />
        </video>
      </div>
      <div ref={starfield} className={`story-starfield ${resultsVisible ? 'story-starfield--results' : ''}`}>
        <SeamlessVideo media={MOVING_STARFIELD} />
      </div>
      <DestinationStars active={resultsVisible} />
      <div className="cinematic-vignette" />
      <div className="cinematic-grain" />
    </div>
  )
}

const MILKY_WAY = {                       // About and Catalog pages
  src: '/media/about-milkyway.mp4',
  poster: '/media/about-milkyway-poster.png',
  playbackRate: 0.8,
  overlap: 1.4,
}

export function CinematicBackdrop({ variant = 'about' }) {
  return (
    <div className={`cinematic-backdrop cinematic-backdrop--${variant}`} aria-hidden="true">
      <SeamlessVideo media={MILKY_WAY} />
      <div className="cinematic-vignette" />
      <div className="cinematic-grain" />
    </div>
  )
}

const DESTINATION_POINTS = [
  [47.1, 17.8],
  [22.4, 29.7],
  [32.2, 50.3],
  [48.3, 71.3],
  [17.2, 79.0],
]

function DestinationStars({ active = true, revealAt = 0 }) {
  const root = useRef(null)

  useGSAP(() => {
    const stars = gsap.utils.toArray('.destination-star')
    if (!active) {
      gsap.set(stars, { autoAlpha: 0, scale: 0.45 })
      return
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      gsap.set(stars, { autoAlpha: 0.72, scale: 1 })
      return
    }

    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .addLabel('destinations', revealAt)
      .fromTo(stars,
        { autoAlpha: 0, scale: 0.45 },
        { autoAlpha: 1, scale: 1.15, duration: 0.7, stagger: 0.12 },
        'destinations')

    stars.forEach((star, index) => {
      gsap.to(star, {
        autoAlpha: 0.55 + index * 0.05,
        scale: 0.85 + index * 0.035,
        duration: 1.15 + index * 0.23,
        delay: revealAt + 0.55 + index * 0.16,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    })
  }, { scope: root, dependencies: [active, revealAt], revertOnUpdate: true })

  return (
    <div ref={root} className="destination-stars">
      {DESTINATION_POINTS.map(([left, top], index) => (
        <span key={index} className="destination-star" style={{ left: `${left}%`, top: `${top}%` }} />
      ))}
    </div>
  )
}

function SeamlessVideo({ media }) {
  const root = useRef(null)
  const first = useRef(null)
  const second = useRef(null)

  useGSAP((_, contextSafe) => {
    const videos = [first.current, second.current]
    const rate = media.playbackRate ?? 1
    const overlap = media.overlap ?? 1.2
    let active = 0
    let transitioning = false
    let raf = 0
    let handoff

    const playFromStart = video => {
      video.currentTime = 0
      video.defaultPlaybackRate = rate
      video.playbackRate = rate
      video.play().catch(() => {})
    }

    const crossfade = contextSafe(() => {
      if (transitioning) return
      transitioning = true
      const outgoing = videos[active]
      const nextIndex = active === 0 ? 1 : 0
      const incoming = videos[nextIndex]
      playFromStart(incoming)

      // fade the incoming copy in ON TOP; the outgoing stays opaque until the fade is done,
      // so the backdrop poster never shows through mid-loop
      gsap.set(incoming, { zIndex: 2 }); gsap.set(outgoing, { zIndex: 1 })
      handoff = gsap.timeline({
        defaults: { duration: overlap / rate, ease: 'none' },
        onComplete: () => {
          gsap.set(outgoing, { autoAlpha: 0 })
          outgoing.pause()
          outgoing.currentTime = 0
          active = nextIndex
          transitioning = false
        },
      })
        .addLabel('handoff')
        .to(incoming, { autoAlpha: 1 }, 'handoff')
    })

    const tick = () => {
      const current = videos[active]
      if (!transitioning && Number.isFinite(current.duration) && current.duration - current.currentTime <= overlap) {
        crossfade()
      }
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      if (!videos.every(video => video.readyState >= 1)) return
      gsap.set(videos[0], { autoAlpha: 1 })
      gsap.set(videos[1], { autoAlpha: 0 })
      playFromStart(videos[0])
    }

    videos.forEach(video => video.addEventListener('loadedmetadata', start))
    start()
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      handoff?.kill()
      videos.forEach(video => {
        video.removeEventListener('loadedmetadata', start)
        video.pause()
      })
    }
  }, { scope: root })

  return (
    <div ref={root} className="cinematic-video-stack">
      <video ref={first} autoPlay muted playsInline preload="auto" poster={media.poster}>
        <source src={media.src} type="video/mp4" />
      </video>
      <video ref={second} muted playsInline preload="auto">
        <source src={media.src} type="video/mp4" />
      </video>
    </div>
  )
}
