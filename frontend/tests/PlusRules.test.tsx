import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PlusRules } from '../src/PlusRules'
import type { Card } from '../src/types'

const cards = (values: string): Card[] => values.split(' ').map((rank, index) => ({ id: String(index), rank,
  suit: rank === 'JOKER' ? 'JOKER' : 'HEARTS' }))

it('teaches the four-card declaration rule without requiring an open tutorial', () => {
  render(<PlusRules />)
  expect(screen.getByText('Jokers are wild')).toBeTruthy()
  expect(screen.getByText('4-card straight → 4 × a rank inside it')).toBeTruthy()
  expect(screen.getByText('Ace can be low (A-2-3-4) or high (J-Q-K-A), never wraparound')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})

it('uses SPELL and joker wildcards for combined rules without changing Plus hints', () => {
  const selection = cards('A 2 SPELL JOKER')
  const { rerender } = render(<PlusRules cards={selection} rank="3" spellWild />)
  expect(screen.getByText('Jokers and SPELL are wild')).toBeTruthy()
  expect(screen.getByText('Straight ready')).toBeTruthy()
  expect(screen.getByText('Truthful as: A · 2 · 3 · 4')).toBeTruthy()
  rerender(<PlusRules cards={selection} rank="3" />)
  expect(screen.getByText('You’re bluffing this rank')).toBeTruthy()
})

it('shows the selected straight’s allowed ranks and warns about an outside-rank bluff', () => {
  const selection = cards('A 2 3 4')
  const { rerender } = render(<PlusRules cards={selection} rank="2" />)
  expect(screen.getByText('Straight ready')).toBeTruthy()
  expect(screen.getByText('Truthful as: A · 2 · 3 · 4')).toBeTruthy()
  rerender(<PlusRules cards={selection} rank="K" />)
  expect(screen.getByText('You’re bluffing this rank')).toBeTruthy()
})

it('distinguishes wildcards, matching natural ranks and a non-straight bluff', () => {
  const { rerender } = render(<PlusRules cards={cards('JOKER')} rank="Q" />)
  expect(screen.getByText('Wildcards selected')).toBeTruthy()
  expect(screen.getByText('Truthful as any rank')).toBeTruthy()
  rerender(<PlusRules cards={cards('A A')} rank="A" />)
  expect(screen.getByText('Your selection')).toBeTruthy()
  rerender(<PlusRules cards={cards('A 6')} />)
  expect(screen.getByText('No truthful rank — this is a bluff')).toBeTruthy()
})
