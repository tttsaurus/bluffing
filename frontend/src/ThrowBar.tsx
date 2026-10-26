import { useEffect, useId, useState } from 'react'
import { throwItems } from '../../shared/throwables'
import { walletBalances } from './presentation'
import { useGameStore } from './store'
import type { RoomView, ThrowItemId } from './types'

export function ThrowBar({ room, playerId, open: controlledOpen, onToggle }: { room: RoomView; playerId: string; open?: boolean; onToggle?: () => void }) {
  const { connected, throwItem, error } = useGameStore()
  const [localOpen, setOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const [target, setTarget] = useState('')
  const panelId = useId()
  const game = room.game!
  const member = room.players.find(player => player.id === playerId)
  const targets = room.players.filter(player => player.id !== playerId && game.hands.some(hand => hand.playerId === player.id))
  const selected = targets.find(player => player.id === target)
  const { room: roomBalance, earned, available } = walletBalances(game, playerId, member?.balance ?? 0)
  useEffect(() => {
    if (!selected) setTarget('')
  }, [selected])
  if (game.phase !== 'ACTIVE' || !game.hands.some(hand => hand.playerId === playerId)) return null
  const purchase = (item: ThrowItemId) => {
    if (selected) throwItem(item, selected.id)
  }
  return <aside className={`throw-dock ${open ? 'expanded' : ''}`} aria-label="Throwing items">
    <button className="throw-dock-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle ?? (() => setOpen(value => !value))}>
      <span className="throw-dock-emblem" aria-hidden="true">✦</span><strong>THROWABLES</strong>
      <span className="throw-dock-balance">{available.toLocaleString()} <i>◆</i></span>
      <span className="throw-dock-chevron" aria-hidden="true">{open ? '⌄' : '⌃'}</span>
      <span className="sr-only">{open ? 'Collapse throwing bar' : 'Expand throwing bar'}</span>
    </button>
    <div className="throw-dock-panel" id={panelId} hidden={!open}>
      <div className="throw-target-row"><label>THROW AT<select aria-label="Throw at" value={selected?.id ?? ''} onChange={event => setTarget(event.target.value)}>
        <option value="">Choose a player</option>{targets.map(player => <option key={player.id} value={player.id}>{player.displayName} #{player.identityTag}</option>)}
      </select></label><span>{selected ? `A little chaos for ${selected.displayName}` : 'Pick a player. Make an entrance.'}</span></div>
      <div className="throw-item-grid">{(Object.keys(throwItems) as ThrowItemId[]).map(id => {
        const item = throwItems[id]
        const disabled = !connected || !selected || available < item.price
        return <button className={`throw-buy throw-buy-${id.toLowerCase()}`} key={id} disabled={disabled}
          aria-label={`Buy and throw ${item.name} for ${item.price} coins`} onClick={() => purchase(id)}
          title={available < item.price ? `Need ${item.price - available} more coins` : selected ? `Throw at ${selected.displayName} #${selected.identityTag}` : 'Choose a target first'}>
          <span className="throw-item-icon" aria-hidden="true">{item.mark}</span><strong>{item.name}</strong><span className="throw-item-price">{item.price} <i>◆</i></span>
        </button>
      })}</div>
      <p className="throw-payment-note"><b>{earned.toLocaleString()} ◆</b> This game + <b>{roomBalance.toLocaleString()} ◆</b> Room wallet · Game earnings spent first · Pending coins excluded</p>
      {error && <p className="throw-purchase-error" role="status">{error}</p>}
    </div>
  </aside>
}
