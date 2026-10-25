import type { Card, GameType } from './types'

export const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
export const suitSymbols = { SPADES: '♠', HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣', JOKER: '✦' }
export const gameModes: Record<GameType, { name: string; cardsPerDeck: number }> = {
  LIARS_DECK: { name: "Liar's Deck", cardsPerDeck: 52 },
  LIARS_DECK_PLUS: { name: "Liar's Deck Plus", cardsPerDeck: 54 },
  LIARS_DECK_4_FUN: { name: "Liar's Deck 4 Fun", cardsPerDeck: 52 },
}

export function straightClaimRanks(cards: Card[]) {
  if (cards.length !== 4) return []
  const natural = cards.filter(card => card.rank !== 'JOKER').map(card => card.rank)
  if (new Set(natural).size !== natural.length) return []
  const windows = ranks.slice(0, 10).map((_, index) => ranks.slice(index, index + 4))
  windows.push(['J', 'Q', 'K', 'A'])
  const allowed = windows.filter(window => natural.every(rank => window.includes(rank))).flat()
  return ranks.filter(rank => allowed.includes(rank))
}

export function truthfulPlusRanks(cards: Card[]) {
  if (!cards.length) return []
  const straight = straightClaimRanks(cards)
  return ranks.filter(rank => straight.includes(rank) || cards.every(card => card.rank === 'JOKER' || card.rank === rank))
}
