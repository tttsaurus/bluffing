import { useEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import { throwItems } from '../../shared/throwables'
import { createThrowShader } from './throwShader'
import type { RoomView, ThrowEvent, ThrowItemId } from './types'

type Point = { x: number; y: number }
type Flying = { event: ThrowEvent; started: number; from: Point; to: Point; targetName: string; sourceName: string }
const duration = (item: ThrowItemId) => item === 'AIRPLANE' ? 950 : item === 'COFFEE' ? 820 : 720
const colors = { TOMATO: '#ff663d', AIRPLANE: '#77e9ff', COFFEE: '#ffc66d' }

function trajectory(effect: Flying, t: number) {
  const arc = Math.min(140, Math.abs(effect.to.x - effect.from.x) * .22 + 60)
  return { x: effect.from.x + (effect.to.x - effect.from.x) * t,
    y: effect.from.y + (effect.to.y - effect.from.y) * t - Math.sin(t * Math.PI) * arc }
}
function drawItem(ctx: CanvasRenderingContext2D, item: ThrowItemId, x: number, y: number, rotation: number, size = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(size, size)
  ctx.shadowBlur = 20; ctx.shadowColor = colors[item]
  if (item === 'TOMATO') {
    const gloss = ctx.createRadialGradient(-8, -10, 2, 0, 0, 25)
    gloss.addColorStop(0, '#ffbc76'); gloss.addColorStop(.35, '#ff4833'); gloss.addColorStop(1, '#a40728')
    ctx.fillStyle = gloss; ctx.beginPath(); ctx.ellipse(0, 0, 23, 21, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0; ctx.fillStyle = '#7be466'; ctx.beginPath()
    for (let i = 0; i < 10; i++) { const angle = i * Math.PI / 5; const radius = i % 2 ? 5 : 15; ctx.lineTo(Math.cos(angle) * radius, -17 + Math.sin(angle) * radius * .5) }
    ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#345e29'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0,-18); ctx.lineTo(5,-29); ctx.stroke()
    ctx.fillStyle = '#fff6d4b0'; ctx.beginPath(); ctx.ellipse(-9,-7,4,7,.6,0,Math.PI*2); ctx.fill()
  } else if (item === 'AIRPLANE') {
    ctx.fillStyle = '#c8f9ff'; ctx.strokeStyle = '#51ccff'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(32,0); ctx.lineTo(-27,-21); ctx.lineTo(-15,-1); ctx.lineTo(-27,21); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.shadowBlur = 0; ctx.fillStyle = '#64a4e3'; ctx.beginPath(); ctx.moveTo(32,0); ctx.lineTo(-15,-1); ctx.lineTo(-27,21); ctx.lineTo(-4,9); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-27,-21); ctx.lineTo(32,0); ctx.lineTo(-27,21); ctx.stroke()
  } else {
    ctx.strokeStyle = '#ffd295'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(21,0,11,13,0,0,Math.PI*2); ctx.stroke()
    const cup = ctx.createLinearGradient(-20,0,20,0); cup.addColorStop(0,'#f3a747'); cup.addColorStop(.4,'#fff1cc'); cup.addColorStop(1,'#bf672d')
    ctx.fillStyle = cup; ctx.beginPath(); ctx.roundRect(-21,-20,42,44,[3,3,13,13]); ctx.fill()
    ctx.shadowBlur = 0; ctx.fillStyle = '#492113'; ctx.beginPath(); ctx.ellipse(0,-19,21,7,0,0,Math.PI*2); ctx.fill()
    ctx.strokeStyle = '#fbe6b9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0,-19,22,8,0,0,Math.PI*2); ctx.stroke()
    ctx.strokeStyle = '#fff4d1aa'; ctx.lineWidth = 3
    for (let i=0;i<3;i++) { ctx.beginPath(); ctx.moveTo(-10+i*10,-30); ctx.bezierCurveTo(-18+i*10,-40,2+i*10,-44,-6+i*10,-53); ctx.stroke() }
  }
  ctx.restore()
}

export function ThrowEffects({ room, arena }: { room: RoomView; arena: RefObject<HTMLDivElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const active = useRef<Flying[]>([])
  const shader = useRef<ReturnType<typeof createThrowShader>>(null)
  const frame = useRef(0)
  const startAnimation = useRef<() => void>(() => {})
  const cursor = useRef({ gameId: room.game!.gameId, id: room.game!.throws?.at(-1)?.id ?? 0 })
  const [notices, setNotices] = useState<Flying[]>([])
  const reduced = useReducedMotion()
  const reducedRef = useRef(reduced)
  useEffect(() => { reducedRef.current = reduced }, [reduced])
  useEffect(() => {
    const surface = canvas.current
    const ctx = surface?.getContext('2d')
    if (!surface || !ctx) return
    shader.current = createThrowShader()
    surface.dataset.renderer = shader.current ? 'webgl' : 'fallback'
    let ratio = Math.min(devicePixelRatio || 1, 1.5)
    let width = innerWidth, height = innerHeight
    const resize = () => {
      ratio = Math.min(devicePixelRatio || 1, 1.5); width = innerWidth; height = innerHeight
      surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio)
      ctx.setTransform(ratio,0,0,ratio,0,0)
    }
    resize()
    const refreshPositions = () => {
      const seats = [...(arena.current?.querySelectorAll<HTMLElement>('.table-seat[data-player-id]') ?? [])]
      for (const effect of active.current) {
        for (const [key, id] of [['from', effect.event.playerId], ['to', effect.event.targetId]] as const) {
          const bounds = seats.find(seat => seat.dataset.playerId === id)?.querySelector('.seat-avatar')?.getBoundingClientRect()
          if (bounds) effect[key] = { x: Math.max(34,Math.min(width-34,bounds.left+bounds.width/2)), y: Math.max(80,Math.min(height-100,bounds.top+bounds.height/2)) }
        }
      }
    }
    const onResize = () => { resize(); refreshPositions() }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', refreshPositions, { passive: true })
    const draw = (now: number) => {
      frame.current = 0
      ctx.clearRect(0,0,width,height)
      active.current = active.current.filter(effect => now-effect.started < duration(effect.event.item)+1650)
      if (!active.current.length) { setNotices([]); return }
      const latest = active.current.at(-1)!
      const phase = now-latest.started >= (reducedRef.current ? 0 : duration(latest.event.item)) ? 'impact' : 'flight'
      if (surface.dataset.phase !== phase) surface.dataset.phase = phase
      for (const effect of active.current) {
        const elapsed = now-effect.started, flightTime = reducedRef.current ? 0 : duration(effect.event.item)
        const { item } = effect.event
        const theme = item === 'TOMATO' ? 0 : item === 'AIRPLANE' ? 1 : 2
        if (elapsed < flightTime) {
          const t = elapsed/flightTime, point = trajectory(effect,t)
          ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = colors[item]; ctx.shadowColor = colors[item]; ctx.shadowBlur = 18
          for (let trail=0;trail<10;trail++) {
            const a=trajectory(effect,Math.max(0,t-trail*.017)), b=trajectory(effect,Math.max(0,t-(trail+1)*.017))
            ctx.globalAlpha=(1-trail/10)*.65; ctx.lineWidth=(1-trail/10)*(item==='AIRPLANE'?6:10)
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke()
          }
          ctx.restore()
          const rotation = item==='AIRPLANE' ? Math.atan2(effect.to.y-effect.from.y-Math.cos(t*Math.PI)*Math.PI*100,effect.to.x-effect.from.x) : t*Math.PI*(item==='TOMATO'?5:3)
          drawItem(ctx,item,point.x,point.y,rotation,1+Math.sin(t*Math.PI)*.25)
        } else {
          const age=(elapsed-flightTime)/1000
          if (reducedRef.current) {
            ctx.globalAlpha=Math.max(0,1-age/1.6); drawItem(ctx,item,effect.to.x,effect.to.y,0,.9); ctx.globalAlpha=1
          } else {
            const burst=shader.current?.draw(age,theme,effect.event.id)
            if (burst) ctx.drawImage(burst,effect.to.x-160,effect.to.y-160,320,320)
            else {
              ctx.save(); ctx.strokeStyle=colors[item]; ctx.lineWidth=5; ctx.globalAlpha=Math.max(0,1-age/1.6)
              ctx.beginPath(); ctx.arc(effect.to.x,effect.to.y,12+age*85,0,Math.PI*2); ctx.stroke(); ctx.restore()
            }
          }
          ctx.save(); ctx.globalAlpha=Math.min(1,age*6)*Math.max(0,1-(age-1)*2); ctx.font='800 13px system-ui'; ctx.textAlign='center'
          const label=`${item==='TOMATO'?'SPLAT!':item==='AIRPLANE'?'AIR STRIKE!':'COFFEE BREAK!'} · ${effect.targetName}`
          const w=Math.min(300,ctx.measureText(label).width+24)
          const labelX=Math.max(w/2+8,Math.min(width-w/2-8,effect.to.x))
          ctx.fillStyle='#08271fe8'; ctx.beginPath(); ctx.roundRect(labelX-w/2,effect.to.y+48,w,30,9); ctx.fill()
          ctx.fillStyle=colors[item]; ctx.fillText(label,labelX,effect.to.y+68,280); ctx.restore()
        }
      }
      frame.current=requestAnimationFrame(draw)
    }
    startAnimation.current=()=>{ if(!frame.current) frame.current=requestAnimationFrame(draw) }
    return () => {
      cancelAnimationFrame(frame.current); frame.current=0; startAnimation.current=()=>{}
      window.removeEventListener('resize', onResize); window.removeEventListener('scroll', refreshPositions)
      shader.current?.dispose(); shader.current=null
    }
  }, [arena])
  useEffect(() => {
    const game=room.game!
    if(cursor.current.gameId!==game.gameId){cursor.current={gameId:game.gameId,id:game.throws?.at(-1)?.id??0};active.current=[];setNotices([]);return}
    const fresh=(game.throws??[]).filter(event=>event.id>cursor.current.id)
    if(!fresh.length)return
    cursor.current.id=fresh.at(-1)!.id
    const seats=[...(arena.current?.querySelectorAll<HTMLElement>('.table-seat[data-player-id]')??[])]
    const point=(id:string):Point=>{
      const bounds=seats.find(seat=>seat.dataset.playerId===id)?.querySelector('.seat-avatar')?.getBoundingClientRect()
      return bounds?{x:Math.max(34,Math.min(innerWidth-34,bounds.left+bounds.width/2)),y:Math.max(80,Math.min(innerHeight-100,bounds.top+bounds.height/2))}:{x:innerWidth/2,y:innerHeight/2}
    }
    const added=fresh.slice(-4).map(event=>({event,started:performance.now(),from:point(event.playerId),to:point(event.targetId),
      targetName:room.players.find(player=>player.id===event.targetId)?.displayName??'Player',sourceName:room.players.find(player=>player.id===event.playerId)?.displayName??'Player'}))
    active.current=[...active.current,...added].slice(-4)
    if(canvas.current)canvas.current.dataset.phase=reducedRef.current?'impact':'flight'
    setNotices(active.current)
    startAnimation.current()
  }, [room.game?.gameId, room.game?.throws, room.players, arena])
  return <div className={`throw-effects ${notices.length?'active':''}`} aria-live="polite" aria-atomic="false">
    <canvas ref={canvas} aria-hidden="true" />
    {notices.map(effect=><span className="sr-only" key={effect.event.id} data-throw-item={effect.event.item} data-throw-target={effect.event.targetId}>
      {effect.sourceName} threw {throwItems[effect.event.item].name} at {effect.targetName}.
    </span>)}
  </div>
}
