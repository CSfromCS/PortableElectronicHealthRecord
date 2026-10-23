import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 6
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_WINDOW_MS = 280
const DOUBLE_TAP_MAX_DISTANCE_PX = 40

type Point = { x: number; y: number }

type PhotoZoomImageProps = {
  src: string
  alt: string
  /** Fired for a single tap/click that is not part of a double-tap (the viewer toggles its chrome here). */
  onTap: () => void
  /**
   * Fired when a two-finger gesture, or a drag while zoomed in, takes over the touch sequence, so the
   * viewer can cancel any one-finger swipe (next/previous, swipe-down-to-close) it had begun tracking.
   */
  onGestureTakeover: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Photo that can be zoomed with a pinch, a double-tap, the mouse wheel or a double-click, and panned
 * by dragging while zoomed in. At 1x it stays out of the way: one-finger touches bubble up unchanged so
 * the viewer's swipe-to-change-photo and swipe-down-to-close gestures keep working. Once zoomed (or
 * during a two-finger gesture) this component owns the touch sequence and stops it from bubbling.
 *
 * The transform is written straight to the <img> (not React state) because it changes every frame of
 * a gesture and this app re-renders its whole tree on every state update. Remount it (via `key`) to
 * reset the zoom when the photo changes.
 */
export function PhotoZoomImage({ src, alt, onTap, onGestureTakeover }: PhotoZoomImageProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const scaleRef = useRef(MIN_SCALE)
  const translateRef = useRef<Point>({ x: 0, y: 0 })

  // The touch sequence currently owned by this component (pinch, or pan while zoomed).
  const ownsTouchRef = useRef(false)
  const pinchRef = useRef<{ startDistance: number; startScale: number; startMid: Point; startTranslate: Point } | null>(null)
  const panRef = useRef<{ last: Point } | null>(null)
  const mouseDragRef = useRef<{ last: Point; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  const lastClickRef = useRef<{ time: number; point: Point } | null>(null)
  const tapTimeoutRef = useRef<number | null>(null)

  // Keep the latest callbacks reachable from the native listeners without re-subscribing them.
  const onTapRef = useRef(onTap)
  const onGestureTakeoverRef = useRef(onGestureTakeover)
  useEffect(() => {
    onTapRef.current = onTap
    onGestureTakeoverRef.current = onGestureTakeover
  }, [onTap, onGestureTakeover])

  const applyTransform = useCallback(() => {
    const image = imageRef.current
    if (!image) return
    const { x, y } = translateRef.current
    const scale = scaleRef.current
    image.style.transform = scale === MIN_SCALE && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${scale})`
    if (wrapperRef.current) wrapperRef.current.style.cursor = scale > MIN_SCALE ? 'grab' : ''
  }, [])

  // Keeps the zoomed photo from being dragged past its own edges (it stays centred when it is
  // smaller than the viewport along an axis).
  const clampTranslate = useCallback((translate: Point, scale: number): Point => {
    const wrapper = wrapperRef.current
    const image = imageRef.current
    if (!wrapper || !image) return translate
    const maxX = Math.max(0, (image.offsetWidth * scale - wrapper.clientWidth) / 2)
    const maxY = Math.max(0, (image.offsetHeight * scale - wrapper.clientHeight) / 2)
    return { x: clamp(translate.x, -maxX, maxX), y: clamp(translate.y, -maxY, maxY) }
  }, [])

  // Zooms to `nextScale` while keeping the photo point under `anchor` (viewport coordinates) fixed,
  // then moves by `pan` (used by pinch, where the finger midpoint travels as well as scales).
  const zoomAround = useCallback((nextScale: number, anchor: Point, base: { scale: number; translate: Point }, pan: Point = { x: 0, y: 0 }) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const fromCentre = { x: anchor.x - (rect.left + rect.width / 2), y: anchor.y - (rect.top + rect.height / 2) }
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    const ratio = scale / base.scale
    const translate = {
      x: fromCentre.x - (fromCentre.x - base.translate.x) * ratio + pan.x,
      y: fromCentre.y - (fromCentre.y - base.translate.y) * ratio + pan.y,
    }
    scaleRef.current = scale
    translateRef.current = scale === MIN_SCALE ? { x: 0, y: 0 } : clampTranslate(translate, scale)
    applyTransform()
  }, [applyTransform, clampTranslate])

  const toggleZoomAt = useCallback((point: Point) => {
    const base = { scale: scaleRef.current, translate: translateRef.current }
    if (base.scale > MIN_SCALE) {
      scaleRef.current = MIN_SCALE
      translateRef.current = { x: 0, y: 0 }
      applyTransform()
      return
    }
    zoomAround(DOUBLE_TAP_SCALE, point, base)
  }, [applyTransform, zoomAround])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const touchPoint = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY })

    const handleTouchStart = (event: TouchEvent) => {
      const zoomedIn = scaleRef.current > MIN_SCALE
      if (event.touches.length >= 2) {
        const first = touchPoint(event.touches[0])
        const second = touchPoint(event.touches[1])
        ownsTouchRef.current = true
        panRef.current = null
        pinchRef.current = {
          startDistance: Math.max(distance(first, second), 1),
          startScale: scaleRef.current,
          startMid: midpoint(first, second),
          startTranslate: translateRef.current,
        }
        onGestureTakeoverRef.current()
      } else if (zoomedIn) {
        ownsTouchRef.current = true
        pinchRef.current = null
        panRef.current = { last: touchPoint(event.touches[0]) }
        onGestureTakeoverRef.current()
      }
      if (ownsTouchRef.current) {
        event.stopPropagation()
        // Only a pinch is cancelled here; a one-finger touch while zoomed must still be able to end
        // as a click so that double-tapping a zoomed photo can zoom back out.
        if (event.touches.length >= 2) event.preventDefault()
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!ownsTouchRef.current) return
      event.stopPropagation()
      event.preventDefault()

      const pinch = pinchRef.current
      if (event.touches.length >= 2 && pinch) {
        const first = touchPoint(event.touches[0])
        const second = touchPoint(event.touches[1])
        const mid = midpoint(first, second)
        const nextScale = pinch.startScale * (distance(first, second) / pinch.startDistance)
        zoomAround(
          nextScale,
          pinch.startMid,
          { scale: pinch.startScale, translate: pinch.startTranslate },
          { x: mid.x - pinch.startMid.x, y: mid.y - pinch.startMid.y },
        )
        return
      }

      const pan = panRef.current
      if (event.touches.length === 1 && pan) {
        const current = touchPoint(event.touches[0])
        translateRef.current = clampTranslate(
          { x: translateRef.current.x + current.x - pan.last.x, y: translateRef.current.y + current.y - pan.last.y },
          scaleRef.current,
        )
        pan.last = current
        applyTransform()
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (!ownsTouchRef.current) return
      event.stopPropagation()

      if (event.touches.length === 0) {
        ownsTouchRef.current = false
        pinchRef.current = null
        panRef.current = null
        return
      }
      // One finger left after a pinch: carry on as a pan from where that finger is now (the pan only
      // moves anything if the photo is still zoomed in).
      if (event.touches.length === 1) {
        pinchRef.current = null
        panRef.current = { last: touchPoint(event.touches[0]) }
      }
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
      zoomAround(
        scaleRef.current * factor,
        { x: event.clientX, y: event.clientY },
        { scale: scaleRef.current, translate: translateRef.current },
      )
    }

    const handleMouseDown = (event: MouseEvent) => {
      suppressClickRef.current = false
      if (event.button !== 0 || scaleRef.current <= MIN_SCALE) return
      event.preventDefault()
      mouseDragRef.current = { last: { x: event.clientX, y: event.clientY }, moved: false }
      wrapper.style.cursor = 'grabbing'
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = mouseDragRef.current
      if (!drag) return
      translateRef.current = clampTranslate(
        { x: translateRef.current.x + event.clientX - drag.last.x, y: translateRef.current.y + event.clientY - drag.last.y },
        scaleRef.current,
      )
      if (Math.abs(event.clientX - drag.last.x) + Math.abs(event.clientY - drag.last.y) > 0) drag.moved = true
      drag.last = { x: event.clientX, y: event.clientY }
      applyTransform()
    }

    const handleMouseUp = () => {
      const drag = mouseDragRef.current
      if (!drag) return
      // A drag ends with a click on the same element; don't let it count as a tap.
      if (drag.moved) suppressClickRef.current = true
      mouseDragRef.current = null
      applyTransform()
    }

    // Non-passive, so preventDefault can stop the browser from page-zooming or scrolling underneath.
    wrapper.addEventListener('touchstart', handleTouchStart, { passive: false })
    wrapper.addEventListener('touchmove', handleTouchMove, { passive: false })
    wrapper.addEventListener('touchend', handleTouchEnd)
    wrapper.addEventListener('touchcancel', handleTouchEnd)
    wrapper.addEventListener('wheel', handleWheel, { passive: false })
    wrapper.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      wrapper.removeEventListener('touchstart', handleTouchStart)
      wrapper.removeEventListener('touchmove', handleTouchMove)
      wrapper.removeEventListener('touchend', handleTouchEnd)
      wrapper.removeEventListener('touchcancel', handleTouchEnd)
      wrapper.removeEventListener('wheel', handleWheel)
      wrapper.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current)
    }
  }, [applyTransform, clampTranslate, zoomAround])

  // Taps are resolved here (not in the viewer) so a double-tap zooms without also flickering the
  // viewer's chrome: a lone tap only reaches `onTap` once the double-tap window has passed.
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    const previous = lastClickRef.current
    const now = Date.now()

    if (previous && now - previous.time <= DOUBLE_TAP_WINDOW_MS && distance(previous.point, point) <= DOUBLE_TAP_MAX_DISTANCE_PX) {
      lastClickRef.current = null
      if (tapTimeoutRef.current !== null) {
        window.clearTimeout(tapTimeoutRef.current)
        tapTimeoutRef.current = null
      }
      toggleZoomAt(point)
      return
    }

    lastClickRef.current = { time: now, point }
    tapTimeoutRef.current = window.setTimeout(() => {
      tapTimeoutRef.current = null
      lastClickRef.current = null
      onTapRef.current()
    }, DOUBLE_TAP_WINDOW_MS)
  }

  return (
    <div
      ref={wrapperRef}
      className='flex h-full w-full items-center justify-center overflow-hidden'
      style={{ touchAction: 'none' }}
      onClick={handleClick}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        className='max-h-full max-w-full select-none object-contain will-change-transform'
      />
    </div>
  )
}
