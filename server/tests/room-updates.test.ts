import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { applyRoomOperations, roomOperations } from '../../shared/roomUpdates.ts'
import type { RoomView } from '../../shared/contracts.ts'
import { engine } from '../src/game/engine.ts'

function fixture() {
  const rules = engine('LIARS_DECK_4_FUN'), players = [randomUUID(), randomUUID()]
  const state = rules.start(randomUUID(), players, { deckCount: 8, cardsPerPlayer: 200 })
  const actor = state.order[state.currentIndex]
  const view = (): RoomView => ({ id: state.roomId, name: 'Large hand', gameType: state.type,
    hostId: actor, status: 'IN_GAME', players: [], skins: [], records: [], notice: null, game: rules.view(state, actor) })
  return { rules, state, actor, view }
}

test('a 200-card play roundtrips without resending removed cards or unchanged private history', t => {
  const f = fixture()
  const cards = f.state.hands[f.actor].slice(0, 200)
  f.state.plays = Array.from({ length: 50 }, (_, id) => ({ id, playerId: f.actor, declaredRank: 'A', cardCount: 200,
    status: 'TRUTH' as const, challengerId: f.actor, revealedCards: cards.map(card => ({ ...card, id: randomUUID() })) }))
  f.state.playSequence = 50
  const before = f.view(), saved = structuredClone(before)
  f.rules.command(f.state, f.actor, { roomId: f.state.roomId, action: 'PLAY', declaredRank: 'A', cardIds: cards.map(card => card.id) })
  const after = f.view()
  const wire = JSON.stringify(roomOperations(before, after))
  const patched = applyRoomOperations(before, JSON.parse(wire))
  assert.deepEqual(patched, after)
  assert.deepEqual(before, saved)
  assert.equal(patched.game!.hand.length, 1)
  assert.equal(patched.game!.poolSize, 200)
  const fullBytes = Buffer.byteLength(JSON.stringify(after)), patchBytes = Buffer.byteLength(wire)
  assert.ok(patchBytes < fullBytes * .05, `Patch ${patchBytes} vs full ${fullBytes} bytes`)
  t.diagnostic(`200-card play: ${patchBytes} update bytes vs ${fullBytes} full snapshot bytes`)
})

test('incremental snapshots preserve unchanged hands and remove previously revealed private data', () => {
  const { view } = fixture()
  const before = view(), next = structuredClone(before)
  next.game!.outcomes = [{ id: 1, type: 'CHECK_FAILED', playerId: 'other', challengerId: 'me', rewardPlayerId: 'other',
    amount: 0, poolSize: 200, declaredRank: 'A', revealedCards: next.game!.hand.slice(0, 200) }]
  const revealed = applyRoomOperations(before, roomOperations(before, next))
  assert.equal(revealed.game!.hand, before.game!.hand)
  const hidden = structuredClone(revealed)
  hidden.game!.outcomes[0].revealedCards = []
  delete hidden.game!.actions
  assert.deepEqual(applyRoomOperations(revealed, roomOperations(revealed, hidden)), hidden)
  assert.equal(revealed.game!.outcomes[0].revealedCards.length, 200)
})

test('room updates handle scattered removals, insertions, histories rolling over and new deals', () => {
  const { view } = fixture()
  let current = view()
  for (let index = 0; index < 30; index++) {
    const next = structuredClone(current)
    next.game!.hand = next.game!.hand.filter((_, card) => card % 7 !== index % 7)
    next.game!.hand.splice(index % (next.game!.hand.length + 1), 0, { id: randomUUID(), rank: 'SPELL', suit: 'SPADES' })
    next.game!.events = [...next.game!.events.slice(-4), `action ${index}`]
    next.game!.actions = [...(next.game!.actions ?? []).slice(-4), { id: index, type: 'FOLD', playerId: 'me', cardCount: 0, declaredRank: 'A' }]
    assert.deepEqual(applyRoomOperations(current, JSON.parse(JSON.stringify(roomOperations(current, next)))), next)
    current = next
  }
  const stopped = { ...current, game: null }
  assert.deepEqual(applyRoomOperations(current, roomOperations(current, stopped)), stopped)
  assert.deepEqual(applyRoomOperations(stopped, roomOperations(stopped, view())), view())
})

test('invalid room update paths cannot mutate prototypes or splice outside their base', () => {
  const { view } = fixture()
  assert.throws(() => applyRoomOperations(view(), [{ path: ['__proto__', 'polluted'], value: true }]))
  assert.throws(() => applyRoomOperations(view(), [{ path: ['game', 'hand'], splice: { start: 500, count: 1, items: [] } }]))
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false)
})
