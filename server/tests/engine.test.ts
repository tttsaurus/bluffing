import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { LiarsDeckEngine, LiarsDeckPlusEngine, LiarsDeck4FunEngine, engine } from '../src/game/engine.ts'
import { RANKS, type GameState } from '../src/game/state.ts'
import type { Card, GameType } from '../../shared/contracts.ts'

const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  room = randomUUID()
const card = (rank: string, suit: Card['suit'] = 'SPADES'): Card => ({
  id: randomUUID(),
  rank,
  suit,
})
test('each mode registers a distinct engine subclass and inherits the immutable classic shop', () => {
  const classic = engine('LIARS_DECK'), plus = engine('LIARS_DECK_PLUS'), fun = engine('LIARS_DECK_4_FUN')
  assert.equal(classic.constructor, LiarsDeckEngine)
  assert.equal(plus.constructor, LiarsDeckPlusEngine)
  assert.equal(fun.constructor, LiarsDeck4FunEngine)
  assert.ok(plus instanceof LiarsDeckEngine && fun instanceof LiarsDeckEngine)
  for (const rules of [plus, fun]) {
    assert.equal(rules.catalog, classic.catalog)
    assert.equal(rules.start, classic.start)
    assert.equal(rules.command, classic.command)
    assert.equal(rules.view, classic.view)
  }
  assert.equal(Object.isFrozen(classic.catalog.skins), true)
  assert.equal(Object.isFrozen(classic.catalog.avatars[0]), true)
  assert.equal(Reflect.set(classic.catalog.skins[0], 'price', 99), false)
  assert.equal(classic.catalog.skins[0].price, 0)
})
function fixture(type: GameType = 'LIARS_DECK', players = [a, b]) {
  const rules = engine(type),
    state = rules.start(room, players, { deckCount: 1, cardsPerPlayer: 3 })
  state.order = [...players]
  state.currentIndex = 0
  state.initializerIndex = 0
  for (const id of players) state.hands[id] = [card('A'), card('2'), card('3')]
  return { rules, state }
}
function play(
  state: GameState,
  player: string,
  rank = 'A',
  cards = [state.hands[player][0]]
) {
  engine(state.type).command(
    state,
    player,
    {
      roomId: room,
      action: 'PLAY',
      cardIds: cards.map((c) => c.id),
      declaredRank: state.targetRank ? undefined : rank,
    },
    1000
  )
}
function fold(state: GameState, player: string) {
  engine(state.type).command(
    state,
    player,
    { roomId: room, action: 'FOLD' },
    1000
  )
}
function challenge(state: GameState, player: string) {
  engine(state.type).command(
    state,
    player,
    { roomId: room, action: 'CHALLENGE' },
    1000
  )
}

for (const type of [
  'LIARS_DECK',
  'LIARS_DECK_PLUS',
  'LIARS_DECK_4_FUN',
] as const) {
  test(`${type} rejects every other mode's state before reading or mutating it`, () => {
    const rules = engine(type)
    for (const other of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN'] as const) {
      if (other === type) continue
      const state = fixture(other).state, before = structuredClone(state)
      for (const operation of [
        () => rules.command(state, a, { roomId: room, action: 'FOLD' }),
        () => rules.depart(state, a), () => rules.tick(state), () => rules.view(state, a),
      ]) {
        assert.throws(operation, /different engine/)
        assert.deepEqual(state, before)
      }
    }
  })
  test(`${type} inherits classic fold-cycle payouts without paying early`, () => {
    const { state } = fixture(type)
    play(state, a)
    fold(state, b)
    assert.equal(state.earnings[a] ?? 0, 0)
    assert.equal(state.pendingClaim?.playerId, a)
    fold(state, a)
    assert.equal(state.earnings[a], 10)
    assert.equal(state.pool.length, 0)
    assert.equal(state.plays.length, 0)
    assert.equal(state.pendingClaim, null)
  })
  test(`${type} inherits classic challenge privacy, rewards and non-folded marker`, () => {
    const { state, rules } = fixture(type)
    play(state, a, 'A', [state.hands[a][1]])
    challenge(state, b)
    assert.equal(state.earnings[b], 20)
    assert.equal(state.lastNonFoldedPlayerId, b)
    assert.equal(rules.view(state, a).plays!.at(-1)!.revealedCards.length, 0)
    assert.equal(rules.view(state, b).plays!.at(-1)!.revealedCards[0].rank, '2')
  })
  test(`${type} deals unique cards, stable random seats, and its own deck composition`, () => {
    const rules = engine(type),
      state = rules.start(room, [a, b, c], {
        deckCount: 2,
        cardsPerPlayer: null,
      })
    assert.equal(
      state.cardsPerPlayer,
      Math.floor((type === 'LIARS_DECK_PLUS' ? 108 : 104) / 3)
    )
    assert.deepEqual(new Set(state.order), new Set([a, b, c]))
    assert.equal(new Set(state.order).size, 3)
    const cards = [...Object.values(state.hands).flat(), ...state.reserve]
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length)
    assert.equal(
      cards.filter((c) => c.rank === 'JOKER').length,
      type === 'LIARS_DECK_PLUS' ? 4 : 0
    )
    assert.equal(
      cards.filter((c) => c.rank === 'SPELL').length,
      type === 'LIARS_DECK_4_FUN' ? 3 : 0
    )
    for (const hand of Object.values(state.hands))
      assert.equal(
        hand.length,
        state.cardsPerPlayer + (type === 'LIARS_DECK_4_FUN' ? 1 : 0)
      )
  })
}
for (const start of Array.from({ length: 11 }, (_, i) => i)) {
  const straight =
    start === 10 ? ['J', 'Q', 'K', 'A'] : RANKS.slice(start, start + 4)
  for (const rank of straight)
    test(`Plus straight ${straight.join('')} can truthfully claim ${rank}`, () => {
      assert.equal(
        engine('LIARS_DECK_PLUS').isTruthful(
          straight.map((rank) => card(rank)),
          rank
        ),
        true
      )
    })
}
for (const [ranks, declared, expected] of [
  [['JOKER', 'JOKER'], 'K', true],
  [['JOKER', '2'], '2', true],
  [['JOKER', '2'], 'A', false],
  [['A', '2', 'JOKER', '4'], '3', true],
  [['A', '2', '3', '4'], '5', false],
  [['Q', 'K', 'A', '2'], 'A', false],
  [['A', 'A', '3', '4'], 'A', false],
  [['A', '2', '3'], 'A', false],
  [['JOKER', 'JOKER', 'JOKER', 'JOKER'], 'K', true],
] as const)
  test(`Plus verdict ${ranks.join(',')} as ${declared} = ${expected}`, () => {
    assert.equal(
      engine('LIARS_DECK_PLUS').isTruthful(
        ranks.map((rank) => card(rank)),
        declared
      ),
      expected
    )
  })
test('Classic does not silently gain Plus jokers, straight rules, or spelling wildcards', () => {
  for (const ranks of [['A', '2', '3', '4'], ['JOKER'], ['SPELL']])
    assert.equal(
      engine('LIARS_DECK').isTruthful(
        ranks.map((rank) => card(rank)),
        'A'
      ),
      false
    )
})
test('settings reject invalid player counts, decks, custom hands and unsupported random decks', () => {
  const rules = engine('LIARS_DECK')
  assert.throws(() =>
    rules.start(room, [a], { deckCount: 1, cardsPerPlayer: null })
  )
  assert.throws(() =>
    rules.start(room, [a, a], { deckCount: 1, cardsPerPlayer: null })
  )
  for (const deckCount of [0, 9, 1.5])
    assert.throws(() =>
      rules.start(room, [a, b], { deckCount, cardsPerPlayer: null })
    )
  for (const size of [0, -1, 27, 2.5])
    assert.throws(() =>
      rules.start(room, [a, b], { deckCount: 1, cardsPerPlayer: size })
    )
  assert.throws(() =>
    rules.start(room, [a, b], {
      deckCount: 1,
      cardsPerPlayer: null,
      randomDeckCount: true,
    })
  )
  assert.throws(() =>
    engine('LIARS_DECK_PLUS').start(room, [a, b], {
      deckCount: 1,
      cardsPerPlayer: 28,
      randomDeckCount: true,
    })
  )
})
test('Plus random deck selection stays between one and active player count', () => {
  for (let i = 0; i < 30; i++) {
    const state = engine('LIARS_DECK_PLUS').start(room, [a, b, c], {
      deckCount: 1,
      cardsPerPlayer: null,
      randomDeckCount: true,
    })
    assert.ok(state.deckCount >= 1 && state.deckCount <= 3)
  }
})
test('moves reject wrong turns, empty cards, duplicate cards, missing cards and changing pool rank', () => {
  const { state, rules } = fixture()
  assert.throws(() => play(state, b))
  assert.throws(() => play(state, a, 'A', []))
  assert.throws(() =>
    play(state, a, 'A', [state.hands[a][0], state.hands[a][0]])
  )
  assert.throws(() => play(state, a, 'A', [card('A')]))
  assert.throws(() => fold(state, a))
  assert.throws(() => challenge(state, a))
  play(state, a)
  assert.throws(() =>
    rules.command(state, b, {
      roomId: room,
      action: 'PLAY',
      cardIds: [state.hands[b][0].id],
      declaredRank: 'K',
    })
  )
})
test('a fold is not a verdict: pending reward is paid only when replaced', () => {
  const { state } = fixture('LIARS_DECK', [a, b, c])
  play(state, a)
  fold(state, b)
  assert.equal(state.earnings[a], undefined)
  assert.equal(state.pendingClaim?.playerId, a)
  play(state, c)
  assert.equal(state.earnings[a], 10)
  assert.equal(state.pendingClaim?.risk, 20)
})
test('all-player fold cycle discards pool, clears recent plays, and pays exactly once', () => {
  const { state } = fixture()
  play(state, a)
  fold(state, b)
  fold(state, a)
  assert.equal(state.pool.length, 0)
  assert.equal(state.plays.length, 0)
  assert.equal(state.earnings[a], 10)
  assert.equal(state.hands[a].length, 2)
  assert.equal(state.hands[b].length, 3)
  assert.equal(state.targetRank, null)
})
test('truth check punishes a lie, rewards only challenger, and moves last-non-folded marker', () => {
  const { state } = fixture()
  play(state, a, 'K')
  challenge(state, b)
  assert.equal(state.earnings[b], 20)
  assert.equal(state.earnings[a], undefined)
  assert.equal(state.hands[a].length, 3)
  assert.equal(state.order[state.currentIndex], b)
  assert.equal(state.lastNonFoldedPlayerId, b)
})
test('failed truth check rewards defender and never moves non-folded mark to challenger', () => {
  const { state } = fixture()
  play(state, a)
  challenge(state, b)
  assert.equal(state.earnings[a], 20)
  assert.equal(state.hands[b].length, 4)
  assert.equal(state.order[state.currentIndex], a)
  assert.equal(state.lastNonFoldedPlayerId, a)
})
test('folds do not hide the previous non-folded player from a later check', () => {
  const { state } = fixture('LIARS_DECK', [a, b, c])
  play(state, a, 'K')
  fold(state, b)
  challenge(state, c)
  assert.equal(state.earnings[c], 20)
  assert.equal(state.outcomes.at(-1)?.playerId, a)
})
test('checked faces are private to initiating challenger in both history and outcomes', () => {
  const { state, rules } = fixture('LIARS_DECK', [a, b, c])
  play(state, a)
  challenge(state, b)
  for (const viewer of [a, b, c]) {
    const view = rules.view(state, viewer, 1000)
    assert.equal(view.plays![0].revealedCards.length, viewer === b ? 1 : 0)
    assert.equal(view.outcomes[0].revealedCards.length, viewer === b ? 1 : 0)
  }
  assert.notEqual(rules.view(state, a).hand, rules.view(state, b).hand)
})
test('an unchallenged lie is accepted without exposing its faces or truth', () => {
  const { state, rules } = fixture()
  play(state, a, 'K')
  play(state, b)
  assert.equal(state.earnings[a], 10)
  assert.equal(state.plays[0].status, 'PASSED')
  assert.equal(rules.view(state, b).plays![0].revealedCards.length, 0)
})
test('last card waits for verdict, then accepted win pays one bonus', () => {
  const { state } = fixture()
  state.hands[a] = [card('A')]
  play(state, a)
  assert.equal(state.phase, 'ACTIVE')
  assert.equal(state.winnerId, null)
  fold(state, b)
  assert.equal(state.winnerId, a)
  assert.equal(state.earnings[a], 135)
  assert.throws(() => fold(state, a))
  assert.equal(state.outcomes.filter((o) => o.type === 'GAME_WON').length, 1)
})
test('invalid commands are transaction-owned: serialization restores full state without process maps', () => {
  const { state } = fixture()
  play(state, a)
  const copy = JSON.parse(JSON.stringify(state)) as GameState
  const fresh = new LiarsDeckEngine()
  fresh.command(copy, b, { roomId: room, action: 'CHALLENGE' })
  assert.equal(copy.earnings[a], 20)
  assert.equal(state.earnings[a], undefined)
})
test('departure voids pending reward, removes hand, and terminates at one remaining player', () => {
  const { state, rules } = fixture()
  play(state, a)
  rules.depart(state, b)
  assert.equal(state.phase, 'FINISHED')
  assert.equal(state.winnerId, null)
  assert.equal(state.earnings[a], undefined)
  assert.equal(state.hands[b], undefined)
  assert.equal(state.plays[0].status, 'VOIDED')
})
test('departing with three players restores unverified empty hand and continues without a payout', () => {
  const { state, rules } = fixture('LIARS_DECK', [a, b, c])
  state.hands[a] = [card('A')]
  play(state, a)
  rules.depart(state, b)
  assert.equal(state.phase, 'ACTIVE')
  assert.equal(state.hands[a].length, 1)
  assert.equal(state.pendingClaim, null)
  assert.equal(state.earnings[a], undefined)
})
function spell() {
  const f = fixture('LIARS_DECK_4_FUN')
  f.state.hands[a] = [card('SPELL'), card('2')]
  play(f.state, a)
  challenge(f.state, b)
  return f
}
test('a checked lone SPELL opens the same timed challenge for everyone without exposing the word', () => {
  const { state, rules } = spell()
  assert.equal(state.spelling?.stage, 'ACTIVE')
  assert.equal(state.spelling?.deadline, 16000)
  const first = rules.view(state, a, 1000).spelling!,
    second = rules.view(state, b, 1000).spelling!
  assert.equal(first.audioUrl, second.audioUrl)
  assert.equal(first.playerCount, 2)
  assert.equal(first.results.length, 0)
  assert.equal(rules.view(state, c).spelling!.audioUrl, null)
  assert.throws(() => fold(state, a))
})
test('mixed SPELL is a wildcard, but never starts a spelling challenge', () => {
  const { state } = fixture('LIARS_DECK_4_FUN')
  state.hands[a] = [card('SPELL'), card('A'), card('2')]
  play(state, a, 'A', state.hands[a].slice(0, 2))
  challenge(state, b)
  assert.equal(state.spelling, null)
  assert.equal(state.earnings[a], 40)
})
test('spelling correct/wrong answers settle once with exact pool-size penalties', () => {
  const { state, rules } = spell(),
    round = state.spelling!,
    beforeA = state.hands[a].length,
    beforeB = state.hands[b].length
  rules.command(
    state,
    a,
    {
      roomId: room,
      action: 'SPELL_ANSWER',
      spellingId: round.id,
      answer: round.questions[a].text,
    },
    2000
  )
  assert.throws(() =>
    rules.command(
      state,
      a,
      {
        roomId: room,
        action: 'SPELL_ANSWER',
        spellingId: round.id,
        answer: 'again',
      },
      2000
    )
  )
  rules.command(
    state,
    b,
    {
      roomId: room,
      action: 'SPELL_ANSWER',
      spellingId: round.id,
      answer: 'wrong',
    },
    2000
  )
  assert.equal(round.stage, 'COMPLETE')
  assert.equal(state.hands[a].length, beforeA)
  assert.equal(state.hands[b].length, beforeB + round.penalty)
  const count = state.hands[b].length
  rules.tick(state, 20000)
  assert.equal(state.hands[b].length, count)
})
test('spelling deadline auto-submits latest draft, including clearing a previous draft', () => {
  const { state, rules } = spell(),
    round = state.spelling!
  for (const answer of [round.questions[a].text, ''])
    rules.command(
      state,
      a,
      { roomId: room, action: 'SPELL_DRAFT', spellingId: round.id, answer },
      2000
    )
  rules.command(
    state,
    b,
    {
      roomId: room,
      action: 'SPELL_DRAFT',
      spellingId: round.id,
      answer: round.questions[b].text,
    },
    2000
  )
  rules.tick(state, round.deadline)
  assert.equal(round.results.find((r) => r.playerId === a)?.answer, '')
  assert.equal(round.results.find((r) => r.playerId === a)?.correct, false)
  assert.equal(round.results.find((r) => r.playerId === b)?.correct, true)
})
test('stale spelling IDs, spectator answers, long answers and late attempts are rejected or settled safely', () => {
  const { state, rules } = spell(),
    round = state.spelling!
  for (const [player, spellingId, answer] of [
    [a, randomUUID(), 'word'],
    [c, round.id, 'word'],
    [a, round.id, 'x'.repeat(65)],
  ]) {
    assert.throws(() =>
      rules.command(
        state,
        player,
        { roomId: room, action: 'SPELL_ANSWER', spellingId, answer },
        2000
      )
    )
  }
  rules.command(
    state,
    a,
    {
      roomId: room,
      action: 'SPELL_ANSWER',
      spellingId: round.id,
      answer: 'late',
    },
    round.deadline
  )
  assert.equal(round.stage, 'COMPLETE')
  assert.equal(round.results.find((r) => r.playerId === a)?.answer, '')
})
test('a final SPELL does not win before spelling resolution', () => {
  const { state, rules } = fixture('LIARS_DECK_4_FUN')
  state.hands[a] = [card('SPELL')]
  play(state, a)
  challenge(state, b)
  assert.equal(state.phase, 'ACTIVE')
  const round = state.spelling!
  for (const player of [a, b])
    rules.command(
      state,
      player,
      {
        roomId: room,
        action: 'SPELL_ANSWER',
        spellingId: round.id,
        answer: round.questions[player].text,
      },
      2000
    )
  assert.equal(state.winnerId, a)
  assert.equal(state.phase, 'FINISHED')
})
