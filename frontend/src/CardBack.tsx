import { useEffect, useRef, useState } from 'react'
import type { SkinId } from './types'
import { createCardArtRenderer, paintStillCardArt } from './cardArt'

/** Original procedural card art; flying cards reuse a cached raster of this artwork. */
export function CardBack({ skin, compact = false, still = false }: {
  skin: SkinId; compact?: boolean; still?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [revision, setRevision] = useState(0)
  const currentSkin = useRef(skin)
  const redraw = useRef<() => void>(() => {})
  useEffect(() => {
    currentSkin.current = skin
    if (still && canvasRef.current) paintStillCardArt(canvasRef.current, skin)
    else redraw.current()
  }, [skin, still])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || still) return
    const renderer = createCardArtRenderer(canvas)
    if (!renderer) return // CSS artwork stays visible without WebGL.
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, visible = true, disposed = false
    const draw = (now: number) => {
      frame = 0
      if (disposed || !visible || document.hidden || renderer.isContextLost()) return
      renderer.draw(currentSkin.current, reduced.matches ? 3 : now / 1000)
      if (canvas.style.opacity !== '1') canvas.style.opacity = '1'
      if (!reduced.matches && currentSkin.current !== 'CLASSIC') frame = requestAnimationFrame(draw)
    }
    const resume = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) }
    redraw.current = resume
    const resizeCanvas = () => {
      // Only read layout on resize, never during an animation frame.
      const ratio = Math.min(devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      resume()
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume() })
    const resize = new ResizeObserver(resizeCanvas)
    observer.observe(canvas)
    resize.observe(canvas)
    document.addEventListener('visibilitychange', resume)
    reduced.addEventListener('change', resume)
    const lost = (event: Event) => { event.preventDefault(); canvas.style.opacity = '0'; cancelAnimationFrame(frame) }
    const restored = () => setRevision(value => value + 1)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    resizeCanvas()
    return () => {
      disposed = true
      redraw.current = () => {}
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      document.removeEventListener('visibilitychange', resume)
      reduced.removeEventListener('change', resume)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      renderer.dispose()
    }
  }, [revision, still])
  return <div className={`skin-card skin-${skin.toLowerCase()} ${compact ? 'compact-back' : ''}`} aria-label={`${skin.toLowerCase()} card back`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="skin-engraving" aria-hidden="true"><span>✦</span><b>♠</b><span>✦</span></div>
    {!compact && <span className="skin-signature" aria-hidden="true">BLUFF / {skin === 'CLASSIC' ? 'HOUSE' : skin}</span>}
  </div>
}
