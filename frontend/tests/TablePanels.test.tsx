import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TablePanels } from '../src/TablePanels'
import { useGameStore } from '../src/store'
import { room, self } from './fixtures'

beforeEach(() => useGameStore.setState({ connected: true, error: null, throwItem: vi.fn(() => true) }))

it('folds both floating panels and opens one at a time without losing the live reward', () => {
  const view = room({ gameType: 'LIARS_DECK_4FUN_PLUS' })
  const { rerender } = render(<TablePanels room={view} playerId={self.id} generation={2} cards={1} value={20} selection={[]} rank="A" />)
  expect(screen.queryByLabelText(/Potential reward:/)).toBeNull()
  const reward = screen.getByRole('button', { name: /Expand reward panel/ })
  fireEvent.click(reward)
  expect(screen.getByLabelText('Potential reward: generation 2 times 1 cards, 20 coins')).toBeTruthy()
  rerender(<TablePanels room={view} playerId={self.id} generation={3} cards={2} value={60} selection={[]} rank="A" />)
  expect(screen.getByLabelText('Potential reward: generation 3 times 2 cards, 60 coins')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Expand throwing bar/ }))
  expect(screen.queryByRole('region', { name: 'Your wallets' })).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Throw at' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: /Expand throwing bar/ })).toBe(document.activeElement)
})
