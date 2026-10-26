import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { suitSymbols } from './gameModes'
import type { Card } from './types'

type Gesture = {
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  previous: number
  dragging: boolean
  selecting: boolean
  baseline: Set<string>
  touched: Set<string>
  cards: { id: string; left: number; right: number }[]
  left: number
  right: number
  top: number
  bottom: number
  scrollStart: number
  maxScroll: number
}

export function CardHand({ cards, selected, disabled, onSelectionChange, scrollRef }: {
  cards: Card[]
  selected: string[]
  disabled: boolean
  onSelectionChange: (ids: string[]) => void
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const [touchSelect, setTouchSelect] = useState(false)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef(0)
  const suppressClick = useRef(false)
  const hintId = useId()
  const cardKey = cards.map(card => card.id).join(',')

  const finish = useCallback((restore = false) => {
    const current = gesture.current
    gesture.current = null
    cancelAnimationFrame(frame.current)
    frame.current = 0
    if (!current) return
    if (restore && current.dragging) onSelectionChange([...current.baseline])
    const container = scrollRef.current
    if (container?.hasPointerCapture(current.pointerId)) container.releasePointerCapture(current.pointerId)
    setDragging(false)
  }, [onSelectionChange, scrollRef])

  useEffect(() => { finish() }, [disabled, cardKey, finish])
  useEffect(() => {
    const cancel = () => finish(true)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const release = (event: globalThis.PointerEvent) => { if (gesture.current?.pointerId === event.pointerId) finish() }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('pointerup', release)
      cancelAnimationFrame(frame.current)
    }
  }, [finish])

  const paint = () => {
    const current = gesture.current
    const container = scrollRef.current
    if (!current || !container || !current.dragging || current.y < current.top - 24 || current.y > current.bottom + 24) return
    const x = Math.max(current.left + 1, Math.min(current.right - 1, current.x)) + container.scrollLeft - current.scrollStart
    // Later cards cover the right edge of earlier cards in the overlapping hand.
    let index = current.cards.length - 1
    while (index >= 0 && (x < current.cards[index].left || x > current.cards[index].right)) index--
    if (index < 0) return
    let changed = false
    for (let i = Math.min(current.previous, index); i <= Math.max(current.previous, index); i++) {
      const id = current.cards[i].id
      if (!current.touched.has(id)) { current.touched.add(id); changed = true }
    }
    current.previous = index
    if (!changed) return
    const selection = new Set(current.baseline)
    for (const id of current.touched) {
      if (current.selecting) selection.add(id)
      else selection.delete(id)
    }
    onSelectionChange(current.cards.map(card => card.id).filter(id => selection.has(id)))
  }

  const autoScroll = () => {
    let last = performance.now()
    const tick = (now: number) => {
      const current = gesture.current
      const container = scrollRef.current
      if (!current?.dragging || !container) return
      const elapsed = Math.min(32, now - last)
      last = now
      if (current.y >= current.top - 24 && current.y <= current.bottom + 24) {
        const edge = 36
        const speed = current.x < current.left + edge ? -Math.min(1, (current.left + edge - current.x) / edge)
          : current.x > current.right - edge ? Math.min(1, (current.x - current.right + edge) / edge) : 0
        if (speed) {
          container.scrollLeft = Math.max(0, Math.min(current.maxScroll, container.scrollLeft + speed * elapsed * .65))
          paint()
        }
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const start = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false
    if (disabled || !event.isPrimary || event.button !== 0 || (event.pointerType === 'touch' && !touchSelect)) return
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-card-id]')
    if (!button || button.disabled) return
    const container = event.currentTarget
    const bounds = container.getBoundingClientRect()
    const positions = [...container.querySelectorAll<HTMLButtonElement>('[data-card-id]')].map(card => {
      const rect = card.getBoundingClientRect()
      return { id: card.dataset.cardId!, left: rect.left, right: rect.right }
    })
    gesture.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      previous: positions.findIndex(card => card.id === button.dataset.cardId), dragging: false,
      selecting: !selected.includes(button.dataset.cardId!), baseline: new Set(selected), touched: new Set(), cards: positions,
      left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
      scrollStart: container.scrollLeft, maxScroll: container.scrollWidth - container.clientWidth,
    }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    if (!current.dragging) {
      if (Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return
      current.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
      suppressClick.current = true
      setDragging(true)
      autoScroll()
    }
    event.preventDefault()
    paint()
  }

  return <div className={`card-hand ${touchSelect ? 'touch-select' : ''} ${dragging ? 'drag-selecting' : ''}`}>
    {cards.length > 0 && <div className="hand-selection-tools">
      <span className="hand-selected-count">{selected.length} selected</span>
      <span id={hintId} className="hand-drag-hint">Drag cards to select · drag selected cards to clear</span>
      <button type="button" className="hand-drag-toggle" aria-pressed={touchSelect} onClick={() => setTouchSelect(value => !value)}>Drag select</button>
      <span className="hand-touch-hint">{touchSelect ? 'Drag cards to select / clear' : 'Swipe to scroll'}</span>
    </div>}
    <div ref={scrollRef} className="cards" aria-label="Your hand" aria-describedby={cards.length ? hintId : undefined}
      onPointerDown={start} onPointerMove={move} onPointerUp={event => { if (gesture.current?.pointerId === event.pointerId) finish() }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) finish(true) }}
      onDragStart={event => event.preventDefault()}
      onClickCapture={event => {
        if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
      }}>
      <div className="cards-track">{cards.map(card => <PlayingCard key={card.id} card={card} selected={selected.includes(card.id)} disabled={disabled}
        onClick={() => onSelectionChange(selected.includes(card.id) ? selected.filter(id => id !== card.id) : [...selected, card.id])} />)}</div>
    </div>
  </div>
}

function PlayingCard({ card, selected, disabled, onClick }: { card: Card; selected: boolean; disabled: boolean; onClick: () => void }) {
  const spell = card.rank === 'SPELL'
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS'
  const joker = card.rank === 'JOKER'
  const suit = spell ? '✦' : suitSymbols[card.suit]
  return <button type="button" data-card-id={card.id} aria-label={spell ? 'Spell card' : joker ? 'Joker (wild card)' : `${card.rank} of ${card.suit.toLowerCase()}`}
    aria-pressed={selected} className={`playing-card ${spell ? 'spell-card' : ''} ${joker ? 'joker-card' : ''} ${red ? 'red' : ''} ${selected ? 'selected' : ''}`}
    disabled={disabled} onClick={onClick}>
    <span>{spell ? 'SPELL' : card.rank}<small>{suit}</small></span><b>{suit}</b>{spell && <em className="spell-card-label">15 SECOND<br />SPELLING TRAP</em>}<span className="bottom">{spell ? 'SPELL' : card.rank}<small>{suit}</small></span>
  </button>
}
