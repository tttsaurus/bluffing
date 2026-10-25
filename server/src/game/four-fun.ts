import { randomUUID } from 'node:crypto'
import type {
  Card,
  GameType,
  GameView
} from '../../../shared/contracts.ts'
import { invariant } from '../errors.ts'
import {
  LiarsDeckEngine,
  event,
  finishIfEmpty,
  shuffle,
  sort
} from './classic.ts'
import type { GameCommand, GameState, InternalClaim } from './state.ts'
import { pickWord } from './words.ts'

/** Only spelling-specific behavior lives here; all normal turns use classic. */
export class LiarsDeck4FunEngine extends LiarsDeckEngine {
  override readonly type: GameType = 'LIARS_DECK_4_FUN'
  protected override readonly wildcardRank = 'SPELL'
  protected override prepareHand(hand: Card[]) {
    hand.push({ id: randomUUID(), rank: 'SPELL', suit: 'SPADES' })
  }
  protected override afterChallenge(
    state: GameState,
    claim: InternalClaim,
    penalty: number,
    truth: boolean,
    now: number
  ) {
    if (claim.cards.length !== 1 || claim.cards[0].rank !== 'SPELL') {
      super.afterChallenge(state, claim, penalty, truth, now)
      return
    }
    const word = pickWord(state.usedWords)
    state.spelling = {
      id: randomUUID(),
      defender: claim.playerId,
      penalty,
      deadline: now + 15_000,
      stage: 'ACTIVE',
      questions: Object.fromEntries(state.order.map((id) => [id, word])),
      answers: {},
      drafts: {},
      results: []
    }
    event(
      state,
      `SPELL trap · everyone spells a word · wrong or timeout draws ${penalty}`
    )
  }
  protected override spellingCommand(
    state: GameState,
    player: string,
    command: GameCommand,
    now: number
  ) {
    const round = state.spelling
    invariant(
      round?.stage === 'ACTIVE' &&
        round.id === command.spellingId &&
        round.questions[player],
      'This spelling challenge is no longer available'
    )
    if (now >= round.deadline) {
      this.tick(state, now)
      return
    }
    invariant(!(player in round.answers), 'Only one answer per challenge')
    invariant(
      typeof command.answer === 'string' && command.answer.length <= 64,
      'Enter a word of at most 64 characters'
    )
    const answer = command.answer.trim().toLowerCase()
    if (command.action === 'SPELL_DRAFT') round.drafts[player] = answer
    else {
      round.answers[player] = answer
      this.advanceSpelling(state, now)
    }
  }
  private advanceSpelling(state: GameState, now: number) {
    const round = state.spelling
    if (
      !round ||
      round.stage !== 'ACTIVE' ||
      (now < round.deadline &&
        Object.keys(round.answers).length <
          Object.keys(round.questions).length)
    )
      return
    for (const [playerId, word] of Object.entries(round.questions)) {
      const answer =
        round.answers[playerId] ?? round.drafts[playerId] ?? ''
      const correct =
        answer === word.text || word.alternatives.includes(answer)
      if (!correct)
        for (let i = 0; i < round.penalty; i++) {
          if (!state.reserve.length)
            state.reserve.push(...shuffle(this.buildDeck(state.deckCount)))
          state.hands[playerId].push(state.reserve.shift()!)
        }
      sort(state.hands[playerId])
      round.results.push({
        playerId,
        word: word.text,
        answer,
        correct,
        drawn: correct ? 0 : round.penalty
      })
    }
    round.stage = 'COMPLETE'
    event(state, 'Spelling complete · challenge resolved')
    if (state.hands[round.defender]) finishIfEmpty(state, round.defender)
  }
  override tick(state: GameState, now = Date.now()) {
    super.tick(state, now)
    if (
      state.phase === 'ACTIVE' &&
      state.spelling?.stage === 'ACTIVE' &&
      now >= state.spelling.deadline
    )
      this.advanceSpelling(state, now)
  }
  protected override afterDeparture(
    state: GameState,
    player: string,
    now: number
  ) {
    const round = state.spelling
    if (round?.stage === 'ACTIVE') {
      delete round.questions[player]
      delete round.answers[player]
      delete round.drafts[player]
      if (state.order.length <= 1) round.stage = 'CANCELLED'
      else this.advanceSpelling(state, now)
    }
  }
  protected override spellingView(
    state: GameState,
    viewer: string,
    now: number
  ): GameView['spelling'] {
    const round = state.spelling
    return (
      round && {
        id: round.id,
        stage: round.stage,
        serverNow: now,
        deadline: round.deadline,
        penalty: round.penalty,
        audioUrl: round.questions[viewer]
          ? `/api/spelling/audio/${round.questions[viewer].id}`
          : null,
        submitted: viewer in round.answers,
        submittedCount: Object.keys(round.answers).length,
        playerCount: Object.keys(round.questions).length,
        results:
          round.stage === 'COMPLETE' ? structuredClone(round.results) : []
      }
    )
  }
}
