import { randomUUID } from 'node:crypto'
import type { Card, GameType } from '../../../shared/contracts.ts'
import { LiarsDeckEngine } from './classic.ts'
import { RANKS } from './state.ts'

export class LiarsDeckPlusEngine extends LiarsDeckEngine {
  override readonly type: GameType = 'LIARS_DECK_PLUS'
  protected override readonly randomDecks = true
  protected override readonly wildcardRank = 'JOKER'
  override cardsPerDeck() {
    return 54
  }
  override buildDeck(count: number): Card[] {
    const cards = super.buildDeck(count)
    for (let n = 0; n < count * 2; n++)
      cards.push({ id: randomUUID(), rank: 'JOKER', suit: 'JOKER' })
    return cards
  }
  override isTruthful(cards: Card[], rank: string): boolean {
    if (super.isTruthful(cards, rank)) return true
    if (
      cards.length !== 4 ||
      !RANKS.includes(rank as (typeof RANKS)[number])
    )
      return false
    const natural = cards
      .filter((card) => card.rank !== 'JOKER')
      .map((card) => card.rank)
    if (new Set(natural).size !== natural.length) return false
    for (let start = 0; start <= 10; start++) {
      const straight: readonly string[] =
        start === 10 ? ['J', 'Q', 'K', 'A'] : RANKS.slice(start, start + 4)
      if (
        straight.includes(rank) &&
        natural.every((value) => straight.includes(value))
      )
        return true
    }
    return false
  }
}
