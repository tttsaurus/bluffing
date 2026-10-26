import { test } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import { engine } from '../src/game/engine.ts'
import { gameCashflow } from '../src/game/throwables.ts'
import { Rooms, type Aggregate } from '../src/rooms.ts'
import { throwItems } from '../../shared/throwables.ts'
import type { GameCommand, GameState } from '../src/game/state.ts'

function fixture(type: 'LIARS_DECK' | 'LIARS_DECK_PLUS' | 'LIARS_DECK_4_FUN' | 'LIARS_DECK_4FUN_PLUS' = 'LIARS_DECK') {
  const rules = engine(type)
  const state = rules.start('room', ['one', 'two'], { deckCount: 1, cardsPerPlayer: 3 })
  state.earnings.one = 220
  return { rules, state }
}
function toss(state: GameState, item: GameCommand['item'], balance: number, targetId = 'two', actor = 'one') {
  engine(state.type).command(state, actor, { roomId: 'room', action: 'THROW', item, targetId, gameId: state.gameId }, 1000, balance)
}
for (const type of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'] as const) {
  for (const [earned, wallet] of [[200, 500], [50, 500], [0, 500]]) {
    test(`${type}: one tomato deducts exactly 100 with ${earned} game coins and ${wallet} room coins`, () => {
      const { state } = fixture(type)
      state.earnings.one = earned
      const before = gameCashflow(state).one
      toss(state, 'TOMATO', earned + wallet)
      const charged = before - gameCashflow(state).one
      assert.equal(charged, 100)
      assert.equal(state.throws?.length, 1)
      assert.equal(state.throwSpending?.one.amount, 100)
      assert.equal(state.throws![0].fromEarnings + state.throws![0].fromWallet, 100)
    })
  }
  test(`${type}: throws spend confirmed earnings first, then room coins, without consuming a turn`, () => {
    const { state, rules } = fixture(type)
    const before = structuredClone(state)
    toss(state, 'COFFEE', 720)
    assert.deepEqual(state.throwSpending?.one, { amount: 300, fromEarnings: 220 })
    assert.deepEqual(state.throws?.[0], { id: 1, playerId: 'one', targetId: 'two', item: 'COFFEE', cost: 300, fromEarnings: 220, fromWallet: 80 })
    assert.equal(state.currentIndex, before.currentIndex)
    assert.deepEqual(state.hands, before.hands)
    assert.deepEqual(state.pool, before.pool)
    assert.deepEqual(state.earnings, before.earnings)
    assert.deepEqual(state.plays, before.plays)
    assert.deepEqual(rules.view(state, 'two').throws, state.throws)
    toss(state, 'TOMATO', 420)
    assert.equal(state.throws?.[1].fromEarnings, 0)
    assert.equal(state.throws?.[1].fromWallet, 100)
  })
  test(`${type}: the public balance is the authoritative total including earned coins`, () => {
    const { state } = fixture(type)
    state.pendingClaim = { playerId: 'one', cards: [], cardCount: 50, generation: 4, risk: 2000 }
    const room: Aggregate = {
      id: 'room', name: 'Wallet test', game_type: type, host_id: 'one', status: 'IN_GAME',
      created_at: new Date(), version: '1', game_state: state, last_notice: null, last_recorded_game_id: null,
      members: ['one', 'two'].map((id, seat) => ({
        id, room_id: 'room', player_id: id, display_name: id, seat_index: seat, active: true,
        balance: id === 'one' ? 720 : 500, game_start_balance: 500,
        equipped_skin: 'CLASSIC', equipped_avatar: 'DEFAULT', owned_skins: [], owned_avatars: [],
        wins: 0, current_streak: 0, best_streak: 0,
      })),
      presence: ['one', 'two'].map(player_id => ({ player_id, room_id: 'room' })),
    }
    const rooms = new Rooms({} as pg.Pool)
    const actor = { id: 'one', display_name: 'one', device_token_hash: '', root_account: false, debug_owner_id: null }
    const check = (earned: number, wallet: number) => {
      const view = rooms.project(room, actor)
      const gross = view.game!.earnings.find(player => player.playerId === 'one')!.amount
      const spent = view.game!.throwSpending?.find(player => player.playerId === 'one')?.fromEarnings ?? 0
      assert.equal(gross - spent, earned)
      assert.equal(view.players.find(player => player.id === 'one')!.balance, earned + wallet)
      assert.equal(earned + wallet, room.members[0].balance)
    }
    check(220, 500)
    toss(state, 'TOMATO', room.members[0].balance)
    room.members[0].balance -= 100
    check(120, 500)
    toss(state, 'COFFEE', room.members[0].balance)
    room.members[0].balance -= 300
    check(0, 320)
    state.earnings.one += 150
    room.members[0].balance += 150
    check(150, 320)
    state.phase = 'FINISHED'
    assert.equal(rooms.project(room, actor).players[0].balance, 470)
    room.game_state = null
    assert.equal(rooms.project(room, actor).players[0].balance, 470)
  })
}
test('prices are authoritative, pending money is excluded, and earnings are never counted twice', () => {
  const { state } = fixture()
  assert.deepEqual(Object.values(throwItems).map(item => item.price), [100, 500, 300])
  state.pendingClaim = { playerId: 'one', cards: [], cardCount: 50, generation: 4, risk: 2000 }
  state.earnings.one = 50
  assert.throws(() => toss(state, 'TOMATO', 50), /Not enough coins/)
  assert.equal(state.throws, undefined)
  state.earnings.one = 500
  assert.throws(() => toss(state, 'AIRPLANE', 499), /Not enough coins/)
  toss(state, 'AIRPLANE', 500)
  assert.equal(state.throwSpending?.one.amount, 500)
  assert.equal(state.throwSpending?.one.fromEarnings, 500)
  assert.throws(() => toss(state, 'TOMATO', 0), /Not enough coins/)
})
test('new payouts settle exactly once after a throw and keep gross earnings separate from costs', () => {
  const { state } = fixture()
  const before = gameCashflow(state)
  toss(state, 'COFFEE', 720)
  const afterThrow = gameCashflow(state)
  assert.equal(afterThrow.one - before.one, -300)
  state.earnings.one += 150
  const afterPayout = gameCashflow(state)
  assert.equal(afterPayout.one - afterThrow.one, 150)
  toss(state, 'TOMATO', 570)
  assert.equal(state.throws?.[1].fromEarnings, 100)
  assert.equal(gameCashflow(state).one - afterPayout.one, -100)
})
test('invalid participants, target, item, phase and wallet values cannot mutate a deal', () => {
  for (const attempt of [
    (state: GameState) => toss(state, 'TOMATO', 500, 'one'),
    (state: GameState) => toss(state, 'TOMATO', 500, 'spectator'),
    (state: GameState) => toss(state, 'TOMATO', 500, 'two', 'spectator'),
    (state: GameState) => toss(state, undefined, 500),
    (state: GameState) => toss(state, 'TOMATO', NaN),
  ]) {
    const { state } = fixture(), before = structuredClone(state)
    assert.throws(() => attempt(state))
    assert.deepEqual(state, before)
  }
  const { state } = fixture()
  state.phase = 'FINISHED'
  assert.throws(() => toss(state, 'TOMATO', 500), /finished/)
})
test('throws work outside your turn, retain increasing IDs, and keep the broadcast bounded', () => {
  const { state } = fixture()
  state.currentIndex = state.order.indexOf('two')
  for (let index = 0; index < 30; index++) toss(state, 'TOMATO', 10000 - index * 100)
  assert.equal(state.throws?.length, 24)
  assert.equal(state.throws?.at(-1)?.id, 30)
  assert.equal(state.throwSpending?.one.amount, 3000)
  assert.equal(state.throwSpending?.one.fromEarnings, 220)
  assert.equal(state.currentIndex, state.order.indexOf('two'))
})
