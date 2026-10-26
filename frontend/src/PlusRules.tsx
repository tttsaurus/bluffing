import type { Card } from './types'
import { straightClaimRanks, truthfulPlusRanks } from './gameModes'

/** Only describes your selection: never exposes another player's face-down cards. */
export function PlusRules({ cards = [], rank, spellWild = false }: { cards?: Card[]; rank?: string | null; spellWild?: boolean }) {
  const straight = straightClaimRanks(cards, spellWild)
  const truthful = truthfulPlusRanks(cards, spellWild)
  const bluff = !!cards.length && !!rank && !truthful.includes(rank)
  return <section className="plus-rules" aria-label={spellWild ? 'Liar’s Deck 4 Fun Plus rules' : 'Liar’s Deck Plus rules'}>
    <header><strong>✦ SPECIAL RULES</strong></header>
    <ul className="special-rule-list">
      <li><b>{spellWild ? 'Jokers and SPELL are wild' : 'Jokers are wild'}</b></li>
      <li>4-card straight → 4 × a rank inside it</li>
      <li>Ace can be low (A-2-3-4) or high (J-Q-K-A), never wraparound</li>
    </ul>
    {cards.length > 0 && <div className={`selection-verdict ${bluff ? 'is-bluff' : 'is-truth'}`} role="status">
      <strong>{bluff ? 'You’re bluffing this rank' : straight.length ? 'Straight ready' : cards.some(card => card.rank === 'JOKER' || (spellWild && card.rank === 'SPELL')) ? 'Wildcards selected' : 'Your selection'}</strong>
      <span>{truthful.length === 13 ? 'Truthful as any rank' : truthful.length ? `Truthful as: ${truthful.join(' · ')}` : 'No truthful rank — this is a bluff'}</span>
    </div>}
  </section>
}

export function FourFunRules() {
  return <section className="plus-rules four-fun-rules" aria-label="Liar’s Deck 4 Fun special rules">
    <header><strong>✦ SPECIAL RULES</strong></header>
    <ul className="special-rule-list">
      <li>Truth-checking a single SPELL card starts a 15-second challenge</li>
      <li>Everyone spells the word; wrong or missed answers draw cards</li>
    </ul>
  </section>
}
