import type { Card, GameType } from '../../../shared/contracts.ts'
import { LiarsDeck4FunEngine } from './four-fun.ts'
import { LiarsDeckPlusEngine } from './plus.ts'

/** Own game state, with 4 Fun's spelling lifecycle and Plus's deck and verdict rules. */
export class LiarsDeck4FunPlusEngine extends LiarsDeck4FunEngine {
  override readonly type: GameType = 'LIARS_DECK_4FUN_PLUS'
  protected override readonly randomDecks = true
  private readonly plusRules = Object.freeze(new LiarsDeckPlusEngine())

  override cardsPerDeck() {
    return this.plusRules.cardsPerDeck()
  }
  override buildDeck(count: number): Card[] {
    return this.plusRules.buildDeck(count)
  }
  override isTruthful(cards: Card[], rank: string): boolean {
    // Normalize only for the verdict. Original SPELL cards remain intact so
    // 4 Fun can distinguish a lone SPELL trap from an ordinary joker play.
    return this.plusRules.isTruthful(cards.map(card => card.rank === 'SPELL'
      ? { ...card, rank: 'JOKER', suit: 'JOKER' as const }
      : card), rank)
  }
}
