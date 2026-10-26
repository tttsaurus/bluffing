import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { recentActions } from './presentation'
import { suitSymbols } from './gameModes'
import { CardBack } from './CardBack'
import { warmCardArt } from './cardArt'
import type { GameView, RoomView, SkinId, TableAction } from './types'

type Point = { x: number; y: number }
type Effect = {
  action: TableAction
  from: Point
  to: Point
  name: string
  skin: SkinId
  play: NonNullable<GameView['plays']>[number] | undefined
}

/** Animate authoritative actions, including those received from other players. */
export function TableActionEffects({ room, arena, onPendingChange }: {
  room: RoomView; arena: RefObject<HTMLDivElement | null>; onPendingChange: (pending: boolean) => void
}) {
  const game = room.game!
  const cursor = useRef({ gameId: game.gameId, id: recentActions(game).at(-1)?.id ?? 0 })
  const [queue, setQueue] = useState<Effect[]>([])
  const reduced = useReducedMotion()
  const equippedSkins = [...new Set(room.players.map(player => player.equippedSkin))].sort().join(',')
  useEffect(() => {
    const warm = () => warmCardArt(equippedSkins.split(',').filter(Boolean) as SkinId[])
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(warm, { timeout: 500 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(warm, 0)
    return () => window.clearTimeout(timer)
  }, [equippedSkins])
  useEffect(() => {
    const actions = recentActions(game)
    if (cursor.current.gameId !== game.gameId) {
      cursor.current = { gameId: game.gameId, id: actions.at(-1)?.id ?? 0 }
      setQueue([])
      return
    }
    const fresh = actions.filter(action => action.id > cursor.current.id)
    if (!fresh.length || !arena.current) return
    cursor.current.id = fresh.at(-1)!.id
    const bounds = arena.current.getBoundingClientRect()
    const center = (element: Element | null): Point => {
      const rect = element?.getBoundingClientRect()
      return rect ? { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top }
        : { x: bounds.width / 2, y: bounds.height / 2 }
    }
    const to = center(arena.current.querySelector('.card-stack, .pool-preview'))
    const seats = [...arena.current.querySelectorAll<HTMLElement>('[data-player-id]')]
    setQueue(queue => [...queue, ...fresh.map(action => ({
      action, to,
      from: center(seats.find(seat => seat.dataset.playerId === action.playerId)?.querySelector('.seat-avatar') ?? null),
      name: room.players.find(player => player.id === action.playerId)?.displayName ?? 'Player',
      skin: room.players.find(player => player.id === action.playerId)?.equippedSkin ?? 'CLASSIC',
      play: game.plays?.find(play => play.id === action.playId),
    }))])
  }, [game, room.players, arena])
  const effect = queue[0]
  useEffect(() => { onPendingChange(queue.length > 0) }, [queue.length, onPendingChange])
  useEffect(() => {
    if (!effect) return
    const timer = window.setTimeout(() => setQueue(queue => queue.slice(1)), effect.action.type === 'CHALLENGE' ? 2400 : 900)
    return () => window.clearTimeout(timer)
  }, [effect])

  return <div className="table-action-effects" aria-live="polite" aria-atomic="true">
    {effect && <ActionEffect key={`${game.gameId}-${effect.action.id}`} effect={effect} reduced={Boolean(reduced)} />}
  </div>
}

function CheckHand() {
  return <svg viewBox="0 0 80 90" className="check-hand" aria-hidden="true">
    <path d="M24 80 18 62 6 47c-5-7 3-14 9-8l9 9V17c0-9 12-9 12 0v23-30c0-9 12-9 12 0v30-24c0-9 12-9 12 0v28-16c0-8 12-8 12 0v30c0 12-8 19-10 22z" fill="currentColor" stroke="#805b2e" strokeWidth="3" strokeLinejoin="round" />
    <path d="M34 53v15m13-17v17m12-15v13" fill="none" stroke="#bb9053" strokeWidth="3" strokeLinecap="round" />
  </svg>
}

function ActionEffect({ effect: { action, from, to, name, play, skin }, reduced }: { effect: Effect; reduced: boolean }) {
  const check = action.type === 'CHALLENGE'
  const fold = action.type === 'FOLD'
  const duration = reduced ? 0 : .48
  const revealDelay = reduced ? 0 : .56
  // Explicit transform keyframes can run on the compositor. The origin stays
  // fixed for the whole throw, so there is no per-frame left/top layout work.
  const flight = (offset: number, startAngle: number, endAngle: number) => {
    const dx = reduced ? offset : from.x - to.x
    const dy = reduced ? 0 : from.y - to.y
    return [
      `translate3d(${dx}px, ${dy}px, 0) rotate(${reduced ? 0 : startAngle}deg) scale(${reduced ? 1 : .7})`,
      `translate3d(${reduced ? offset : dx * .42}px, ${reduced ? 0 : dy * .42 - 32}px, 0) rotate(${reduced ? 0 : endAngle - 8}deg) scale(${reduced ? 1 : 1.06})`,
      `translate3d(${offset}px, 0, 0) rotate(${reduced ? 0 : endAngle}deg) scale(1)`,
    ]
  }
  const verdict = play?.status === 'LIE' ? 'BLUFF CAUGHT' : play?.status === 'TRUTH' ? 'VERIFIED TRUE' : 'REVEAL'
  return <div className={`table-action-effect effect-${action.type.toLowerCase()}`} data-action-id={action.id} data-player-id={action.playerId}>
    <span className="sr-only">{name} {fold ? 'folded. No cards played.' : check ? `called a truth check. ${verdict}.` : `played ${action.cardCount} cards as ${action.declaredRank}.`}</span>
    {fold ? <motion.div className="fold-cue" style={{ left: from.x, top: from.y }}
      initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: [0, 1, 1, 0], y: reduced ? 0 : -36 }} transition={{ duration: .85 }} aria-hidden="true">FOLDED</motion.div>
      : <>
        {check ? <motion.div className="thrown-hand" aria-hidden="true" style={{ left: to.x, top: to.y }}
          initial={{ transform: flight(0, -25, 12)[0], opacity: 0 }}
          animate={{ transform: flight(0, -25, 12), opacity: [0, 1, 1, 0] }}
          transition={{ duration: reduced ? .12 : .56, transform: { times: [0, .55, 1], ease: 'easeOut' }, opacity: { times: [0, .12, .82, 1] } }}><CheckHand /></motion.div>
          : Array.from({ length: Math.min(action.cardCount, 6) }, (_, index) => <motion.div key={index} className="thrown-card" aria-hidden="true"
            style={{ left: to.x, top: to.y }}
            initial={{ transform: flight((index - 1) * 7, -24 + index * 9, (index - 2) * 6)[0], opacity: 0 }}
            animate={{ transform: flight((index - 1) * 7, -24 + index * 9, (index - 2) * 6), opacity: [0, 1, 1, 0] }}
            transition={{ duration: duration || .12, delay: reduced ? 0 : index * .03, transform: { times: [0, .55, 1], ease: 'easeOut' }, opacity: { times: [0, .12, .9, 1] } }}><CardBack skin={skin} compact still /></motion.div>)}
        <motion.div className={`pool-action-cue ${check ? 'pool-check-reveal' : ''}`} style={{ left: to.x, top: to.y }} aria-hidden="true"
          initial={{ opacity: 0, scale: reduced ? 1 : .7 }} animate={{ opacity: [0, 1, 1, 0], scale: 1 }}
          transition={{ delay: check ? revealDelay : duration, duration: check ? 1.8 : .4, times: [0, .1, .85, 1] }}>
          {check ? <>
            <span className="pool-check-label">TRUTH CHECK · REVEAL</span>
            <div className="pool-reveal-cards">{Array.from({ length: Math.min(action.cardCount, 6) }, (_, index) => {
              const card = play?.revealedCards[index]
              return <motion.span key={index} className={`pool-reveal-card ${card?.rank === 'JOKER' || card?.rank === 'SPELL' ? 'special-rank' : ''} ${card?.suit === 'HEARTS' || card?.suit === 'DIAMONDS' ? 'red' : ''}`}
                initial={{ rotateY: reduced ? 0 : 90 }} animate={{ rotateY: 0 }} transition={{ delay: revealDelay + (reduced ? 0 : index * .08), duration: reduced ? 0 : .35 }}>
                {card ? <><span className="reveal-card-rank">{card.rank}</span><small>{suitSymbols[card.suit]}</small></> : <span>?</span>}
              </motion.span>
            })}</div>
            {action.cardCount > 6 && <small>+{action.cardCount - 6} more cards checked</small>}
            <strong className={play?.status === 'LIE' ? 'reveal-lie' : 'reveal-truth'}>{verdict}</strong>
            {!play?.revealedCards.length && <small>Card faces revealed to the checker</small>}
          </> : <strong>+{action.cardCount} {action.cardCount === 1 ? 'CARD' : 'CARDS'}</strong>}
        </motion.div>
      </>}
  </div>
}
