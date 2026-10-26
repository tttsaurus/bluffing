import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useGameStore } from './store'
import { freshOutcomes, gameWallet, outcomeCopy, recentActions, shouldNotifyOutcome, turnOrder } from './presentation'
import type { GameOutcome, RoomView } from './types'
import { suitSymbols } from './gameModes'

function playerName(room: RoomView, id: string) {
  const member = room.players.find(player => player.id === id)
  const record = room.records.find(player => player.playerId === id)
  const player = member ?? record
  return player ? `${player.displayName} #${player.identityTag}` : 'Player'
}

export function Wallets({ room, playerId }: { room: RoomView; playerId: string }) {
  const game = room.game!
  const wallet = gameWallet(game, playerId)
  const member = room.players.find(player => player.id === playerId)
  const previous = useRef(wallet.earned)
  const [deposit, setDeposit] = useState<{ amount: number; id: number } | null>(null)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    const difference = wallet.earned - previous.current
    previous.current = wallet.earned
    if (difference > 0) setDeposit({ amount: difference, id: Date.now() })
  }, [wallet.earned])
  useEffect(() => {
    if (!deposit) return
    const timer = window.setTimeout(() => setDeposit(null), 3200)
    return () => window.clearTimeout(timer)
  }, [deposit])
  if (!member) return null
  const latest = [...(game.outcomes ?? [])].reverse().find(event => event.playerId === playerId || event.rewardPlayerId === playerId || event.challengerId === playerId)
  const copy = latest && outcomeCopy(latest, playerId, id => playerName(room, id))
  return <section className="wallet-panel" aria-label="Your wallets">
    <div className="wallet-grid">
      <div className={`wallet-cell game-wallet ${deposit ? 'deposit-active' : ''}`}>
        <span>THIS GAME</span><motion.strong key={wallet.earned} initial={false} animate={reduceMotion ? {} : { scale: [1, 1.12, 1] }}>+{wallet.earned.toLocaleString()} <i>◆</i></motion.strong>
      </div>
      <div className={`wallet-cell pending-wallet ${wallet.pending ? 'has-pending' : ''}`}>
        <span>AWAITING VERDICT</span><strong>{wallet.pending ? wallet.pending.toLocaleString() : '—'} <i>◇</i></strong>
      </div>
      <div className={`wallet-cell room-wallet ${deposit ? 'deposit-active' : ''}`}>
        <span>ROOM WALLET</span><strong>{member.balance.toLocaleString()} <i>◆</i></strong>
        <AnimatePresence>{deposit && <motion.div className="coin-deposit" key={deposit.id} initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">+{deposit.amount} BANKED ✓</motion.div>}</AnimatePresence>
      </div>
    </div>
    {wallet.pending > 0 ? <div className="wallet-receipt receipt-pending"><span className="verdict-spinner" aria-hidden="true">◇</span><strong>Your play is pending</strong><span>Safe play → +{wallet.pending} · Defend truth → +{wallet.pending * 2}</span></div>
      : latest && copy ? <div className={`wallet-receipt receipt-${copy.tone}`}><b>{copy.mark}</b><strong>{copy.title}</strong><span>{latest.rewardPlayerId === playerId ? `+${latest.amount} banked` : latest.type === 'PLAY_VOIDED' ? 'No payout' : 'No coins earned'} · {copy.detail}</span></div>
      : null}
  </section>
}

export function TurnOrder({ room, playerId, connected }: { room: RoomView; playerId: string; connected: boolean }) {
  const { kickPlayer, player } = useGameStore()
  const game = room.game!
  const order = turnOrder(game)
  const mine = game.currentPlayerId === playerId
  const lastPlay = game.plays?.at(-1)
  const position = order.find(hand => hand.playerId === playerId)?.ahead ?? -1
  const reduceMotion = useReducedMotion()
  const seatsRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = seatsRef.current
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!list || !current) return
    const bounds = list.getBoundingClientRect()
    const seat = current.getBoundingClientRect()
    const shift = seat.left < bounds.left ? seat.left - bounds.left
      : seat.right > bounds.right ? seat.right - bounds.right : 0
    if (shift) list.scrollBy({ left: shift, behavior: reduceMotion ? 'instant' : 'smooth' })
  }, [game.currentPlayerId, game.hands.length, reduceMotion])
  return <section className={`turn-order ${mine && connected ? 'your-turn' : ''}`} aria-label="Round order">
    <motion.div className="turn-callout" key={`${game.currentPlayerId}-${connected}`} initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} role="status">
      <span>{!connected ? 'CONNECTION LOST' : mine ? 'YOUR TURN' : position === 1 ? 'YOU’RE NEXT' : 'TURN ORDER'}</span>
    </motion.div>
    <ol ref={seatsRef}>{order.map(hand => <li key={hand.playerId} className={`${hand.ahead === 0 ? 'current' : ''} ${hand.playerId === playerId ? 'self' : ''} ${lastPlay?.playerId === hand.playerId ? 'last-non-folded' : ''}`} aria-current={hand.ahead === 0 ? 'step' : undefined}>
      {hand.ahead === 0 && <motion.div className="order-active-indicator" layoutId={`active-seat-${game.gameId}`} initial={false}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 32 }} aria-hidden="true"><span>NOW</span></motion.div>}
      {lastPlay?.playerId === hand.playerId && <span className="last-non-folded-marker" aria-label="Last non-folded player" title="Last non-folded player">LAST NON-FOLDED</span>}
      <span className="order-timing">SEAT {String(hand.seat).padStart(2, '0')} <b aria-hidden="true">→</b></span>
      <strong>{hand.playerId === playerId ? 'You' : room.players.find(member => member.id === hand.playerId)?.displayName ?? 'Player'}</strong>
      <span className="order-detail">#{room.players.find(member => member.id === hand.playerId)?.identityTag} · {hand.cardCount} cards</span>
      {hand.ahead === 0 && <span className={`order-thinking ${connected ? '' : 'reconnecting'}`} role="status">
        {connected ? <>THINKING<span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span></> : 'RECONNECTING…'}
      </span>}
      {(player?.root || room.hostId === playerId) && hand.playerId !== playerId && <button className="order-kick" aria-label={`Kick ${playerName(room, hand.playerId)}`} onClick={() => void kickPlayer(room.id, hand.playerId)}>×</button>}
    </li>)}</ol>
  </section>
}

// Lives at room level so a final payout animation survives the table → waiting transition.
export function RoundFeedback() {
  const { room, player } = useGameStore()
  const game = room?.game
  const cursor = useRef({ gameId: game?.gameId, id: game?.outcomes?.at(-1)?.id ?? 0 })
  const [queue, setQueue] = useState<GameOutcome[]>([])
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    if (cursor.current.gameId !== game?.gameId) {
      cursor.current = { gameId: game?.gameId, id: 0 }
      setQueue([])
    }
    const fresh = freshOutcomes(game?.outcomes ?? [], cursor.current.id)
    if (!fresh.length) return
    cursor.current.id = fresh.at(-1)!.id
    const notices = fresh.filter(outcome => player && shouldNotifyOutcome(outcome, player.id))
    if (notices.length) setQueue([notices.at(-1)!])
  }, [game?.gameId, game?.outcomes, player])
  const event = queue[0]
  useEffect(() => {
    if (!event) return
    const timer = window.setTimeout(() => setQueue([]), 3600)
    return () => window.clearTimeout(timer)
  }, [event])
  if (!room || !player) return null
  const copy = event && outcomeCopy(event, player.id, id => playerName(room, id))
  return <div className="verdict-layer"><AnimatePresence>{event && copy && <motion.aside
    className={`verdict-card verdict-${copy.tone}`} key={`${game?.gameId}-${event.id}`} role="status" aria-live="polite"
    initial={{ opacity: 0, y: reduceMotion ? 0 : -28, scale: reduceMotion ? 1 : .88 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }} transition={{ type: 'spring', damping: 19, stiffness: 270 }}>
    <div className="verdict-stamp" aria-hidden="true">{copy.mark}</div>
    <div className="verdict-content"><span className="verdict-label">{event.type.startsWith('CHECK_') ? 'TRUTH CHECK · VERDICT' : event.type === 'PLAY_VOIDED' ? 'REWARD CANCELLED' : 'REWARD CONFIRMED'}</span><h2>{copy.title}</h2><p>{copy.detail}</p>
      {event.challengerId === player.id && event.revealedCards.length > 0 && <><p className="checked-rank">Claimed {event.declaredRank}s · revealed to you</p><div className="revealed-cards" aria-label="Checked cards">{event.revealedCards.map(card => <span key={card.id} className={card.suit === 'HEARTS' || card.suit === 'DIAMONDS' ? 'red' : ''}>{card.rank}{suitSymbols[card.suit]}</span>)}</div></>}
      {event.amount > 0 && event.rewardPlayerId === player.id && <div className="verdict-payment"><strong>+{event.amount} ◆</strong><span>BANKED TO YOUR WALLET</span></div>}
    </div><button className="verdict-close" aria-label="Dismiss result" onClick={() => setQueue([])}>×</button>
  </motion.aside>}</AnimatePresence></div>
}

export function PlayHistory({ room }: { room: RoomView }) {
  const actions = room.game ? [...recentActions(room.game)].reverse() : []
  const labels = { PENDING: 'Awaiting check', PASSED: 'Accepted', TRUTH: 'Verified true', LIE: 'Bluff caught', VOIDED: 'Cancelled' }
  return <section className="play-history" aria-label="Recent plays">
    <header><h3>Recent plays</h3></header>
    {actions.length === 0 ? <p>No cards played yet.</p> : <ol>{actions.map(action => {
      const play = room.game?.plays?.find(play => play.id === action.playId)
      const folded = action.type === 'FOLD'
      const checked = action.type === 'CHALLENGE'
      return <li key={action.id} className={folded ? 'history-fold' : checked ? 'history-check' : ''}>
        <div className="play-history-player"><small>#{action.id}</small><strong>{playerName(room, action.playerId)}</strong></div>
        {folded ? <><div className="play-history-claim"><b>Folded</b><span>No cards played</span></div><span className="play-status status-fold">FOLD</span></>
          : <>
            <div className="play-history-claim"><b>{checked ? 'Truth check' : `${action.cardCount} × ${action.declaredRank}`}</b><span>{checked ? `Checked ${action.cardCount} × ${action.declaredRank}` : 'claimed'}</span></div>
            <div className="play-history-cards" aria-label={play?.revealedCards.length ? 'Cards revealed to you' : action.cardCount + ' hidden cards'}>
              {play?.revealedCards.length ? play.revealedCards.map(card => <span key={card.id} className={card.suit === 'HEARTS' || card.suit === 'DIAMONDS' ? 'red' : ''}>{card.rank}{suitSymbols[card.suit]}</span>)
                : <><span className="hidden-card">?</span><small>× {action.cardCount}</small></>}
            </div>
            {play && <span className={'play-status status-' + play.status.toLowerCase()}>{labels[play.status]}</span>}
          </>}
      </li>
    })}</ol>}
  </section>
}
