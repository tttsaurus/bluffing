import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { RoomView } from './types'

const fallback = new Map<string, string>()
const storageKey = (roomId: string, playerId: string, kind: string) =>
  `bluff-table-notice:${playerId}:${roomId}:${kind}`

function read(key: string) {
  try { return fallback.get(key) ?? sessionStorage.getItem(key) }
  catch { return fallback.get(key) }
}

function remember(key: string, value: string) {
  fallback.set(key, value)
  try { sessionStorage.setItem(key, value) } catch { /* Keep tab-local memory when storage is unavailable. */ }
}

export function clearTableResetNotice(roomId: string, playerId: string) {
  const key = storageKey(roomId, playerId, 'reset')
  fallback.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* The memory fallback has already been cleared. */ }
}

export function WaitingRoomNotice({ room, playerId }: { room: RoomView; playerId: string }) {
  const finished = room.game?.phase === 'FINISHED' ? room.game : null
  const winner = room.players.find(member => member.id === finished?.winnerId)
  const value = finished?.gameId ?? room.notice
  if (!value) return null
  const key = storageKey(room.id, playerId, finished ? 'finished' : 'reset')
  return <TransientMatchResult key={`${key}:${value}`} noticeKey={key} value={value}
    title={finished ? winner ? `♛ ${winner.displayName} #${winner.identityTag} won the deal` : 'Deal ended · not enough players' : '■ Table reset'}
    description={finished ? winner ? 'Ready for another hand?' : room.notice ?? 'No winner bonus. Room wallets restored.' : room.notice!} />
}

function TransientMatchResult({ noticeKey, value, title, description }: {
  noticeKey: string; value: string; title: string; description: string
}) {
  const [visible, setVisible] = useState(() => read(noticeKey) !== value)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!visible) return
    // A notice is consumed when shown, even if the player leaves before it fades.
    remember(noticeKey, value)
    const timer = window.setTimeout(() => setVisible(false), 6500)
    return () => window.clearTimeout(timer)
  }, [noticeKey, value, visible])
  return <AnimatePresence>{visible && <motion.div className="match-result-slot"
    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
    transition={{ height: { duration: reduced ? 0 : .36, ease: [.22, 1, .36, 1] }, opacity: { duration: reduced ? 0 : .18 } }}>
    <div className="match-result" role="status"><b>{title}</b><span>{description}</span></div>
  </motion.div>}</AnimatePresence>
}
