import { describe, expect, it } from 'vitest'
import { gameModes, straightClaimRanks, truthfulPlusRanks } from '../src/gameModes'
import type { Card } from '../src/types'

const cards = (values: string): Card[] => values.split(' ').map((rank, index) => ({
  id: String(index), rank, suit: rank === 'JOKER' ? 'JOKER' : 'SPADES',
}))

describe('Plus truthful rank hints match the server rules', () => {
  it.each([
    ['A 2 3 4', ['A', '2', '3', '4']],
    ['2 3 4 5', ['2', '3', '4', '5']],
    ['4 A 3 2', ['A', '2', '3', '4']],
    ['10 J Q K', ['10', 'J', 'Q', 'K']],
    ['J Q K A', ['A', 'J', 'Q', 'K']],
    ['A 2 3 JOKER', ['A', '2', '3', '4']],
    ['2 4 JOKER JOKER', ['A', '2', '3', '4', '5']],
    ['Q K A 2', []], ['K A 2 3', []], ['A 3 4 5', []], ['2 2 3 4', []],
    ['A 2 3', []], ['A 2 3 4 5', []],
  ] as [string, string[]][])('suggests only legal straight ranks for %s', (selection, allowed) => {
    expect(straightClaimRanks(cards(selection))).toEqual(allowed)
  })

  it('allows matching ranks plus jokers at any card count, but does not invent straights', () => {
    expect(truthfulPlusRanks(cards('A A JOKER A A'))).toEqual(['A'])
    expect(truthfulPlusRanks(cards('2 2 JOKER JOKER'))).toEqual(['2'])
    expect(truthfulPlusRanks(cards('JOKER'))).toHaveLength(13)
    expect(truthfulPlusRanks(cards('JOKER JOKER JOKER JOKER'))).toHaveLength(13)
    expect(truthfulPlusRanks([])).toEqual([])
    expect(straightClaimRanks(cards('bad 2 3 4'))).toEqual([])
  })

  it('catalog differentiates the classic 52-card deck from the 54-card Plus deck', () => {
    expect(gameModes.LIARS_DECK.cardsPerDeck).toBe(52)
    expect(gameModes.LIARS_DECK_PLUS.cardsPerDeck).toBe(54)
  })
  it('variants inherit classic setup defaults, with random decks restricted to Plus', () => {
    expect(gameModes.LIARS_DECK_4_FUN.cardsPerDeck).toBe(gameModes.LIARS_DECK.cardsPerDeck)
    expect(gameModes.LIARS_DECK_4_FUN.randomDecks).toBe(false)
    expect(gameModes.LIARS_DECK.randomDecks).toBe(false)
    expect(gameModes.LIARS_DECK_PLUS.randomDecks).toBe(true)
    expect(gameModes.LIARS_DECK_4_FUN.ruleHints).toEqual(['spelling'])
    expect(gameModes.LIARS_DECK_PLUS.ruleHints).toEqual(['plus'])
  })

  it('combines setup and wildcard hints only for 4 Fun Plus', () => {
    expect(gameModes.LIARS_DECK_4FUN_PLUS).toMatchObject({ cardsPerDeck: 54, randomDecks: true, ruleHints: ['plus', 'spelling'] })
    expect(truthfulPlusRanks(cards('SPELL JOKER'), true)).toHaveLength(13)
    expect(truthfulPlusRanks(cards('A 2 SPELL JOKER'), true)).toEqual(['A', '2', '3', '4'])
    expect(truthfulPlusRanks(cards('A 2 SPELL JOKER'))).toEqual([])
    expect(truthfulPlusRanks(cards('Q K A 2'), true)).toEqual([])
  })
})
