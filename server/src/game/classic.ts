import { randomInt, randomUUID } from 'node:crypto'
import type {
  Card,
  GameType,
  GameView,
  GameOutcome
} from '../../../shared/contracts.ts'
import { invariant } from '../errors.ts'
import { classicCatalog } from './catalog.ts'
import { purchaseThrow } from './throwables.ts'
import {
  RANKS,
  type GameCommand,
  type GameState,
  type InternalClaim,
  type StartSettings
} from './state.ts'

export function shuffle<T>(values: T[]): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}
function rankIndex(card: Card) {
  const i = RANKS.indexOf(card.rank as (typeof RANKS)[number])
  return i < 0 ? 99 : i
}
export function sort(hand: Card[]) {
  hand.sort((a, b) => rankIndex(a) - rankIndex(b))
}
export function event(state: GameState, message: string) {
  state.events.unshift(message)
  state.events.splice(8)
}
function claimView(claim: InternalClaim | null) {
  return (
    claim && {
      playerId: claim.playerId,
      cardCount: claim.cards.length,
      generation: claim.generation,
      risk: claim.risk
    }
  )
}
function outcome(
  state: GameState,
  type: GameOutcome['type'],
  playerId: string,
  challengerId: string | null,
  rewardPlayerId: string | null,
  amount: number,
  revealedCards: Card[] = [],
  penaltyMode?: GameOutcome['penaltyMode']
) {
  state.outcomes.push({
    id: ++state.outcomeSequence,
    type,
    playerId,
    challengerId,
    rewardPlayerId,
    amount,
    poolSize: state.pool.length,
    declaredRank: state.targetRank,
    revealedCards: structuredClone(revealedCards),
    ...(penaltyMode ? { penaltyMode } : {})
  })
  if (state.outcomes.length > 32) state.outcomes.shift()
}
function pay(state: GameState, player: string, amount: number) {
  invariant(Number.isSafeInteger(amount) && amount >= 0, 'Invalid reward')
  state.earnings[player] = (state.earnings[player] ?? 0) + amount
}
function resolvePlay(
  state: GameState,
  status: NonNullable<GameView['plays']>[number]['status'],
  challengerId: string | null = null,
  cards: Card[] = []
) {
  const play = state.plays.at(-1)
  if (play)
    Object.assign(play, {
      status,
      challengerId,
      revealedCards: structuredClone(cards)
    })
}
function clearPool(state: GameState) {
  state.pool = []
  state.claims = []
  state.targetRank = null
  state.consecutiveFolds = 0
  state.pendingClaim = null
}
function recordAction(state: GameState, type: 'PLAY' | 'FOLD' | 'CHALLENGE', playerId: string) {
  // Optional for deals persisted before the action log was introduced.
  const actions = state.actions ??= (type === 'PLAY' ? state.plays.slice(0, -1) : state.plays).map(play => ({
    id: play.id, type: 'PLAY' as const, playerId: play.playerId, playId: play.id,
    cardCount: play.cardCount, declaredRank: play.declaredRank,
  }))
  const play = state.plays.at(-1)
  actions.push({
    id: (actions.at(-1)?.id ?? 0) + 1,
    type,
    playerId,
    playId: type === 'FOLD' ? undefined : play?.id,
    cardCount: type === 'FOLD' ? 0 : play?.cardCount ?? 0,
    declaredRank: state.targetRank,
  })
  if (actions.length > 50) actions.shift()
}
export function finishIfEmpty(state: GameState, playerId: string) {
  if (state.hands[playerId]?.length !== 0) return false
  state.winnerId = playerId
  state.phase = 'FINISHED'
  const bonus = 100 + state.deckCount * 25
  pay(state, playerId, bonus)
  outcome(state, 'GAME_WON', playerId, null, playerId, bonus)
  event(state, `Final play accepted · winner bonus ${bonus}`)
  return true
}
function securePending(
  state: GameState,
  reason: 'PLAY_PASSED' | 'POOL_PASSED'
) {
  const claim = state.pendingClaim
  if (!claim) return
  resolvePlay(state, 'PASSED')
  pay(state, claim.playerId, claim.risk)
  outcome(state, reason, claim.playerId, null, claim.playerId, claim.risk)
  event(state, `Play passed · ${claim.risk} coins secured`)
  state.pendingClaim = null
}

/** Engines are stateless rules over a transaction-owned aggregate, not process-owned room maps. */
export class LiarsDeckEngine {
  readonly type: GameType = 'LIARS_DECK'
  readonly catalog = classicCatalog
  protected readonly randomDecks: boolean = false
  protected readonly wildcardRank: string | null = null
  protected assertState(state: GameState) {
    invariant(
      state.type === this.type,
      'This game belongs to a different engine',
      400
    )
  }
  protected prepareHand(_hand: Card[]) {}
  cardsPerDeck() {
    return 52
  }
  buildDeck(count: number): Card[] {
    const cards: Card[] = []
    for (let d = 0; d < count; d++) {
      for (const suit of [
        'SPADES',
        'HEARTS',
        'DIAMONDS',
        'CLUBS'
      ] as const) {
        for (const rank of RANKS)
          cards.push({ id: randomUUID(), rank, suit })
      }
    }
    return cards
  }
  isTruthful(cards: Card[], rank: string): boolean {
    if (!cards.length || !RANKS.includes(rank as (typeof RANKS)[number]))
      return false
    return cards.every(
      (card) => card.rank === rank || card.rank === this.wildcardRank
    )
  }
  start(
    roomId: string,
    members: string[],
    settings: StartSettings
  ): GameState {
    invariant(
      members.length >= 2 &&
        members.length <= 8 &&
        new Set(members).size === members.length,
      'Between two and eight players are required'
    )
    invariant(
      !settings.randomDeckCount || this.randomDecks,
      'Random deck counts are only available in Plus game modes'
    )
    invariant(
      Number.isInteger(settings.deckCount) &&
        settings.deckCount >= 1 &&
        settings.deckCount <= 8,
      'Deck count must be between 1 and 8'
    )
    invariant(
      !settings.randomDeckCount ||
        settings.cardsPerPlayer == null ||
        settings.cardsPerPlayer * members.length <= this.cardsPerDeck(),
      'With random decks, custom hands must fit in one deck'
    )
    const deckCount = settings.randomDeckCount
      ? randomInt(1, members.length + 1)
      : settings.deckCount
    const available = deckCount * this.cardsPerDeck()
    const handSize =
      settings.cardsPerPlayer ?? Math.floor(available / members.length)
    invariant(
      Number.isInteger(handSize) &&
        handSize >= 1 &&
        handSize * members.length <= available,
      'That hand size needs more cards than the selected decks provide'
    )
    const deck = shuffle(this.buildDeck(deckCount)),
      order = shuffle([...members])
    const hands: Record<string, Card[]> = Object.fromEntries(
      order.map((id) => [id, []])
    )
    let cursor = 0
    for (let n = 0; n < handSize; n++)
      for (const id of order) hands[id].push(deck[cursor++])
    for (const hand of Object.values(hands)) {
      this.prepareHand(hand)
      sort(hand)
    }
    const first = randomInt(order.length)
    return {
      schemaVersion: 1,
      gameId: randomUUID(),
      roomId,
      type: this.type,
      phase: 'ACTIVE',
      deckCount,
      cardsPerPlayer: handSize,
      order,
      participants: [...order],
      hands,
      pool: [],
      reserve: deck.slice(cursor),
      usedWords: [],
      claims: [],
      pendingClaim: null,
      currentIndex: first,
      initializerIndex: first,
      consecutiveFolds: 0,
      targetRank: null,
      earnings: {},
      outcomes: [],
      plays: [],
      actions: [],
      events: [
        `New game · ${deckCount} deck${deckCount === 1 ? '' : 's'} · ${handSize} cards each`
      ],
      winnerId: null,
      lastNonFoldedPlayerId: null,
      spelling: null,
      playSequence: 0,
      outcomeSequence: 0
    }
  }
  command(
    state: GameState,
    playerId: string,
    command: GameCommand,
    now = Date.now(),
    walletBalance = 0
  ) {
    this.assertState(state)
    invariant(state.phase === 'ACTIVE', 'This game has finished')
    if (command.action === 'THROW') {
      purchaseThrow(state, playerId, command, walletBalance)
      return
    }
    if (
      command.action === 'SPELL_ANSWER' ||
      command.action === 'SPELL_DRAFT'
    ) {
      this.spellingCommand(state, playerId, command, now)
      return
    }
    invariant(
      state.spelling?.stage !== 'ACTIVE',
      'Finish the spelling challenge first'
    )
    invariant(
      state.order[state.currentIndex] === playerId,
      'It is not your turn'
    )
    if (command.action === 'PLAY') this.play(state, playerId, command)
    else if (command.action === 'FOLD') this.fold(state)
    else if (command.action === 'CHALLENGE')
      this.challenge(state, playerId, now)
    else invariant(false, 'Unknown game action', 400)
  }
  private play(state: GameState, playerId: string, command: GameCommand) {
    const ids = command.cardIds ?? [],
      hand = state.hands[playerId]
    invariant(ids.length > 0, 'Select at least one card')
    invariant(
      new Set(ids).size === ids.length,
      'A card can only be played once'
    )
    const played = ids.map((id) => {
      const card = hand.find((card) => card.id === id)
      invariant(card, 'One of those cards is not in your hand')
      return card
    })
    if (state.targetRank == null) {
      const rank = command.declaredRank?.trim().toUpperCase()
      invariant(
        rank && RANKS.includes(rank as (typeof RANKS)[number]),
        'Choose a valid rank for the new pool'
      )
      state.targetRank = rank
      state.initializerIndex = state.currentIndex
    } else
      invariant(
        !command.declaredRank?.trim() ||
          command.declaredRank.trim().toUpperCase() === state.targetRank,
        `This pool is already declared as ${state.targetRank}s`
      )
    const previousPlayer = state.pendingClaim?.playerId
    securePending(state, 'PLAY_PASSED')
    if (previousPlayer && finishIfEmpty(state, previousPlayer)) return
    state.hands[playerId] = hand.filter((card) => !ids.includes(card.id))
    const generation = state.claims.length + 1,
      risk = generation * played.length * 10
    const claim = {
      playerId,
      cards: played,
      cardCount: played.length,
      generation,
      risk
    }
    state.pendingClaim = claim
    state.claims.push(claim)
    state.lastNonFoldedPlayerId = playerId
    state.plays.push({
      id: ++state.playSequence,
      playerId,
      declaredRank: state.targetRank!,
      cardCount: played.length,
      status: 'PENDING',
      challengerId: null,
      revealedCards: []
    })
    if (state.plays.length > 50) state.plays.shift()
    recordAction(state, 'PLAY', playerId)
    state.pool.push(...played)
    state.consecutiveFolds = 0
    event(
      state,
      `A player claimed ${played.length} × ${state.targetRank} · risk ${risk}`
    )
    state.currentIndex = (state.currentIndex + 1) % state.order.length
  }
  private fold(state: GameState) {
    invariant(
      state.pool.length,
      'The pool initializer must play at least one card'
    )
    state.consecutiveFolds++
    recordAction(state, 'FOLD', state.order[state.currentIndex])
    event(state, 'A player folded')
    if (
      state.pendingClaim &&
      state.hands[state.pendingClaim.playerId].length === 0 &&
      state.consecutiveFolds >= state.order.length - 1
    ) {
      const candidate = state.pendingClaim.playerId
      securePending(state, 'POOL_PASSED')
      finishIfEmpty(state, candidate)
      clearPool(state)
      return
    }
    if (state.consecutiveFolds >= state.order.length) {
      securePending(state, 'POOL_PASSED')
      event(
        state,
        'Everyone folded · pool vanished · final pending play paid'
      )
      clearPool(state)
      state.initializerIndex = state.currentIndex
    } else
      state.currentIndex = (state.currentIndex + 1) % state.order.length
  }
  private challenge(state: GameState, challenger: string, now: number) {
    const claim = state.claims.at(-1)
    invariant(claim, 'There is no claim to challenge')
    invariant(
      claim.playerId !== challenger,
      'You cannot challenge your own claim'
    )
    const truth = this.isTruthful(claim.cards, state.targetRank!)
    const pool = state.pool,
      penalty = pool.length,
      recipient = this.challengePenaltyRecipient(claim, challenger, truth),
      next = truth ? claim.playerId : challenger
    pay(state, next, claim.risk * 2)
    event(
      state,
      `${recipient ? `${truth ? 'Truth! Challenger' : 'Lie caught! Bluffer'} takes ${penalty} cards` : 'Card penalties await the special challenge'} · ${claim.risk * 2} coins earned`
    )
    outcome(
      state,
      truth ? 'CHECK_FAILED' : 'CHECK_SUCCEEDED',
      claim.playerId,
      challenger,
      next,
      claim.risk * 2,
      claim.cards,
      recipient === null ? 'SPELLING' : undefined
    )
    resolvePlay(state, truth ? 'TRUTH' : 'LIE', challenger, claim.cards)
    recordAction(state, 'CHALLENGE', challenger)
    if (recipient !== null) {
      state.hands[recipient].push(...state.pool)
      sort(state.hands[recipient])
    }
    clearPool(state)
    state.currentIndex = state.order.indexOf(next)
    state.initializerIndex = state.currentIndex
    if (!truth) state.lastNonFoldedPlayerId = challenger
    this.afterChallenge(state, claim, penalty, truth, now, pool)
  }
  protected challengePenaltyRecipient(claim: InternalClaim, challenger: string, truth: boolean): string | null {
    return truth ? challenger : claim.playerId
  }
  protected afterChallenge(
    state: GameState,
    claim: InternalClaim,
    _penalty: number,
    truth: boolean,
    _now: number,
    _pool: Card[]
  ) {
    if (truth) finishIfEmpty(state, claim.playerId)
  }
  protected spellingCommand(
    _state: GameState,
    _player: string,
    _command: GameCommand,
    _now: number
  ) {
    invariant(
      false,
      'This engine does not support spelling challenges',
      400
    )
  }
  tick(state: GameState, _now = Date.now()) {
    this.assertState(state)
  }
  protected afterDeparture(
    _state: GameState,
    _player: string,
    _now: number
  ) {}
  depart(state: GameState, player: string, now = Date.now()) {
    this.assertState(state)
    if (state.phase !== 'ACTIVE' || !state.order.includes(player)) return
    let nextPlayer = state.order[state.currentIndex]
    if (nextPlayer === player)
      nextPlayer =
        state.order[(state.currentIndex + 1) % state.order.length]
    state.order = state.order.filter((id) => id !== player)
    delete state.hands[player]
    this.afterDeparture(state, player, now)
    if (state.pendingClaim) {
      resolvePlay(state, 'VOIDED')
      const pending = state.pendingClaim,
        hand = state.hands[pending.playerId]
      if (hand?.length === 0) hand.push(...pending.cards)
      outcome(state, 'PLAY_VOIDED', pending.playerId, null, null, 0)
    }
    clearPool(state)
    state.currentIndex = Math.max(0, state.order.indexOf(nextPlayer))
    state.initializerIndex = state.currentIndex
    event(
      state,
      'Player left the deal · unresolved pool discarded without payout'
    )
    if (state.order.length <= 1) {
      state.phase = 'FINISHED'
      state.winnerId = null
      event(
        state,
        'Deal ended · fewer than two players remain · no winner bonus'
      )
    }
  }
  view(state: GameState, viewer: string, now = Date.now()): GameView {
    this.assertState(state)
    return {
      gameId: state.gameId,
      phase: state.phase,
      deckCount: state.deckCount,
      cardsPerPlayer: state.cardsPerPlayer,
      currentPlayerId: state.order[state.currentIndex] ?? null,
      initializerId: state.order[state.initializerIndex] ?? null,
      targetRank: state.targetRank,
      poolSize: state.pool.length,
      generation: state.claims.length + 1,
      consecutiveFolds: state.consecutiveFolds,
      lastClaim: claimView(state.claims.at(-1) ?? null),
      hand: structuredClone(state.hands[viewer] ?? []),
      hands: state.order.map((playerId) => ({
        playerId,
        cardCount: state.hands[playerId].length
      })),
      events: [...state.events],
      winnerId: state.winnerId,
      participants: [...state.participants],
      actions: state.actions && structuredClone(state.actions),
      throws: structuredClone(state.throws ?? []),
      throwSpending: Object.entries(state.throwSpending ?? {}).map(([playerId, spending]) => ({ playerId, ...spending })),
      pendingClaim: claimView(state.pendingClaim),
      earnings: state.participants.map((playerId) => ({
        playerId,
        amount: state.earnings[playerId] ?? 0
      })),
      outcomes: state.outcomes.map((item) => ({
        ...item,
        revealedCards:
          item.challengerId === viewer
            ? structuredClone(item.revealedCards)
            : []
      })),
      plays: state.plays.map((item) => ({
        ...item,
        revealedCards:
          item.challengerId === viewer
            ? structuredClone(item.revealedCards)
            : []
      })),
      spelling: this.spellingView(state, viewer, now),
      lastNonFoldedPlayerId: state.lastNonFoldedPlayerId
    }
  }
  protected spellingView(
    _state: GameState,
    _viewer: string,
    _now: number
  ): GameView['spelling'] {
    return null
  }
}
