import { useId, useState } from 'react'
import { motion } from 'motion/react'
import { ThrowBar } from './ThrowBar'
import { Wallets } from './GameFeedback'
import { FourFunRules, PlusRules } from './PlusRules'
import { gameModes } from './gameModes'
import type { Card, RoomView } from './types'

export function TablePanels({ room, playerId, generation, cards, value, selection, rank }: {
  room: RoomView; playerId: string; generation: number; cards: number; value: number; selection: Card[]; rank: string
}) {
  const [open, setOpen] = useState<'throws' | 'reward' | null>(null)
  const panelId = useId()
  const mode = gameModes[room.gameType]
  const toggle = (panel: 'throws' | 'reward') => setOpen(current => current === panel ? null : panel)
  return <div className="table-docks" aria-label="Table panels" onKeyDown={event => {
    if (event.key === 'Escape') {
      setOpen(null)
      const toggle = event.currentTarget.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
      toggle?.focus()
    }
  }}>
    <ThrowBar room={room} playerId={playerId} open={open === 'throws'} onToggle={() => toggle('throws')} />
    <aside className={`throw-dock reward-dock ${open === 'reward' ? 'expanded' : ''}`} aria-label="Reward and wallet">
      <button className="throw-dock-toggle" aria-expanded={open === 'reward'} aria-controls={panelId} onClick={() => toggle('reward')}>
        <span className="throw-dock-emblem" aria-hidden="true">◆</span><strong>REWARD</strong>
        <span className="throw-dock-balance">{value.toLocaleString()} <i>◆</i></span>
        <span className="throw-dock-chevron" aria-hidden="true">{open === 'reward' ? '⌄' : '⌃'}</span>
        <span className="sr-only">{open === 'reward' ? 'Collapse reward panel' : 'Expand reward panel'}</span>
      </button>
      <div className="throw-dock-panel reward-dock-panel" id={panelId} hidden={open !== 'reward'}>
        {open === 'reward' && <>
        <div className="reward-board-heading"><strong>{mode.name}</strong><span>POTENTIAL REWARD</span></div>
        <motion.div className="risk-box" aria-label={`Potential reward: generation ${generation} times ${cards} cards, ${value} coins`} initial={false} animate={{ scale: selection.length ? [1, 1.025, 1] : 1 }} transition={{ duration: .24 }}>
          <div className="risk-formula" aria-label={`${generation} times ${cards}`}>
            <div className="risk-factor generation" aria-label="Generation"><strong>{generation}</strong></div>
            <b className="risk-operator">×</b>
            <div className="risk-factor cards-factor" aria-label="Cards"><strong>{cards}</strong></div>
          </div>
          <div className="risk-payout"><span>× 10</span><strong>{value.toLocaleString()}</strong><b>◆</b></div>
        </motion.div>
        <Wallets room={room} playerId={playerId} />
        {mode.ruleHints.length > 0 && <details className="panel-rules"><summary>Game rules &amp; selection hints</summary>
          {mode.ruleHints.includes('plus') && <PlusRules cards={selection} rank={rank} spellWild={mode.ruleHints.includes('spelling')} />}
          {mode.ruleHints.includes('spelling') && <FourFunRules />}
        </details>}
        </>}
      </div>
    </aside>
  </div>
}
