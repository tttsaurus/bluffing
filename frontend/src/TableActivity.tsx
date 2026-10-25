import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PlayerAvatar } from './PlayerAvatar'
import { useGameStore } from './store'
import type { RoomView } from './types'

function PlayerName({ room, id, showTag = true }: { room: RoomView; id: string | null; showTag?: boolean }) {
  const player = room.players.find(player => player.id === id)
    ?? room.records.find(player => player.playerId === id)
  return <span className="activity-player-name">{player?.displayName ?? 'Player'}{showTag && player && <small>#{player.identityTag}</small>}</span>
}

export function TableActivity({ room, myTurn }: { room: RoomView; myTurn: boolean }) {
  const game = room.game!
  const latestPlay = game.plays?.at(-1)
  const reduceMotion = useReducedMotion()
  const turnKey = `${game.currentPlayerId}-${latestPlay?.id ?? 0}-${game.generation}-${game.consecutiveFolds}`
  return <>
    <div className="table-play-layer" aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="wait">{latestPlay ? <motion.div className="table-play-announcement" key={latestPlay.id}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 22, scale: reduceMotion ? 1 : .85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -14 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
        <span className="play-announcement-player"><PlayerName room={room} id={latestPlay.playerId} /> <span>played</span></span>
        <strong className="play-announcement-claim">{latestPlay.cardCount} <span>×</span> {latestPlay.declaredRank}</strong>
      </motion.div> : <div className="table-play-empty">No cards played yet · Open the round</div>}</AnimatePresence>
    </div>
    <div className="your-turn-anchor">
      <AnimatePresence mode="wait">{myTurn && <motion.div className="your-turn-cue" key={turnKey} role="status"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 18, scale: reduceMotion ? 1 : .9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
        <span aria-hidden="true">◆</span> YOUR TURN <span aria-hidden="true">◆</span>
      </motion.div>}</AnimatePresence>
    </div>
  </>
}

/** Fixed seat positions keep the viewer's avatar anchored while turns move around the table. */
export function TableSeats({ room, playerId }: { room: RoomView; playerId: string }) {
  const { player, kickPlayer } = useGameStore()
  const game = room.game!
  const spellingRunning = game.spelling?.stage === 'ACTIVE'
  const hands = game.hands
  const selfIndex = hands.findIndex(hand => hand.playerId === playerId)
  const seats = selfIndex < 0 ? hands : [...hands.slice(selfIndex), ...hands.slice(0, selfIndex)]
  return <ol className="table-seats" aria-label="Players around the table">{seats.map((hand, index) => {
    const member = room.players.find(member => member.id === hand.playerId)
    const angle = Math.PI / 2 + index * Math.PI * 2 / Math.max(1, seats.length)
    const current = !spellingRunning && game.currentPlayerId === hand.playerId
    const self = hand.playerId === playerId
    const lastNonFolded = game.lastNonFoldedPlayerId === hand.playerId
    const status = spellingRunning ? 'SPELLING' : current ? 'THINKING…' : member?.presence === 'OFFLINE' ? 'OFFLINE' : null
    return <li key={hand.playerId} className={`table-seat ${current ? 'current' : ''} ${self ? 'self' : ''} ${lastNonFolded ? 'last-non-folded' : ''}`}
      style={self ? undefined : { left: `${50 + 44 * Math.cos(angle)}%`, top: `${50 + 43 * Math.sin(angle)}%` }}
      aria-current={current ? 'step' : undefined}>
      {lastNonFolded && <span className="seat-non-folded-marker" aria-label="Last non-folded player">LAST NON-FOLDED</span>}
      <div className="seat-avatar"><PlayerAvatar avatar={member?.equippedAvatar} /><span>{hand.cardCount}</span></div>
      {status && <small>{status}</small>}
      <strong title={`${member?.displayName ?? 'Player'} #${member?.identityTag ?? ''}`}>{member?.displayName ?? 'Player'}<span className="seat-identity-tag">#{member?.identityTag}</span></strong>
      {self && <small>YOU</small>}
      {(player?.root || room.hostId === playerId) && !self && <button className="seat-remove" aria-label={`Kick ${member?.displayName ?? 'Player'}`} onClick={() => void kickPlayer(room.id, hand.playerId)}>×</button>}
    </li>
  })}</ol>
}
