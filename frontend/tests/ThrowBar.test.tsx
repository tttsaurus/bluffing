import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ThrowBar } from '../src/ThrowBar'
import { useGameStore } from '../src/store'
import { gameWallet } from '../src/presentation'
import { game, other, room, self } from './fixtures'

beforeEach(() => useGameStore.setState({ connected: true, error: null, throwItem: vi.fn(() => true) }))
const expand = () => fireEvent.click(screen.getByRole('button', { name: /Expand throwing bar/ }))

it('spending 100 earned coins reduces the displayed total by 100, never 200', () => {
  const view = room({ game: game({ earnings: [{ playerId: self.id, amount: 100 }] }) })
  view.players[0].balance = 600 // Already includes the 100 earned coins.
  const { rerender } = render(<ThrowBar room={view} playerId={self.id} />)
  expect(screen.getByText('600', { selector: '.throw-dock-balance' })).toBeTruthy()
  const updated = structuredClone(view)
  updated.players[0].balance = 500
  updated.game!.throwSpending = [{ playerId: self.id, amount: 100, fromEarnings: 100 }]
  rerender(<ThrowBar room={updated} playerId={self.id} />)
  expect(screen.getByText('500', { selector: '.throw-dock-balance' })).toBeTruthy()
})

it.each(['LIARS_DECK','LIARS_DECK_PLUS','LIARS_DECK_4_FUN','LIARS_DECK_4FUN_PLUS'] as const)('offers the three prices, a target picker and a fold toggle in %s', gameType => {
  render(<ThrowBar room={room({ gameType })} playerId={self.id} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  expand()
  const target = screen.getByRole('combobox', { name: 'Throw at' })
  expect(screen.getByRole('option', { name: `Dealer #${other.identityTag}` })).toBeTruthy()
  expect(screen.queryByRole('option', { name: `Dealer #${self.identityTag}` })).toBeNull()
  fireEvent.change(target, { target: { value: other.id } })
  for (const [name, price] of [['Tomato',100],['Airplane',500],['Coffee',300]]) {
    expect(screen.getByRole('button', { name: `Buy and throw ${name} for ${price} coins` }).hasAttribute('disabled')).toBe(false)
  }
  fireEvent.click(screen.getByRole('button', { name: /Collapse throwing bar/ }))
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('ignores pending rewards when the combined confirmed balances are insufficient', () => {
  const view = room({ game: game({ earnings: [{ playerId: self.id, amount: 50 }], pendingClaim: { playerId: self.id, cardCount: 20, generation: 5, risk: 1000 } }) })
  view.players[0].balance = 99
  render(<ThrowBar room={view} playerId={self.id} />)
  expand()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } })
  expect(screen.getByText('99')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Buy and throw Tomato for 100 coins' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(/Pending coins excluded/)).toBeTruthy()
})

it.each([
  { earned: 500, wallet: 0 },
  { earned: 250, wallet: 250 },
  { earned: 0, wallet: 500 },
])('enables purchases using $earned game coins plus $wallet room coins', ({ earned, wallet }) => {
  const view = room({ game: game({ earnings: [{ playerId: self.id, amount: earned }] }) })
  view.players[0].balance = earned + wallet
  render(<ThrowBar room={view} playerId={self.id} />)
  expect(screen.getByText('500', { selector: '.throw-dock-balance' })).toBeTruthy()
  expand()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } })
  const airplane = screen.getByRole('button', { name: 'Buy and throw Airplane for 500 coins' })
  expect(airplane.hasAttribute('disabled')).toBe(false)
  fireEvent.click(airplane)
  expect(useGameStore.getState().throwItem).toHaveBeenCalledWith('AIRPLANE', other.id)
})

it('purchases outside your turn and shows the server balance without adding earnings twice', () => {
  const view = room({ game: game({ currentPlayerId: other.id, earnings: [{ playerId: self.id, amount: 220 }] }) })
  view.players[0].balance = 720
  const { rerender } = render(<ThrowBar room={view} playerId={self.id} />)
  expect(screen.getByText('720')).toBeTruthy()
  expand()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } })
  const coffee = screen.getByRole('button', { name: 'Buy and throw Coffee for 300 coins' })
  fireEvent.click(coffee)
  expect(useGameStore.getState().throwItem).toHaveBeenCalledWith('COFFEE', other.id)
  expect(coffee.hasAttribute('disabled')).toBe(false)
  const updated = structuredClone(view)
  updated.players[0].balance = 420
  updated.game!.throws = [{ id: 1, item: 'COFFEE', playerId: self.id, targetId: other.id, cost: 300, fromEarnings: 220, fromWallet: 80 }]
  updated.game!.throwSpending = [{ playerId: self.id, amount: 300, fromEarnings: 220 }]
  rerender(<ThrowBar room={updated} playerId={self.id} />)
  expect(gameWallet(updated.game!, self.id)).toEqual({ earned: 0, pending: 0 })
  expect(coffee.hasAttribute('disabled')).toBe(false)
  expect(screen.getByText('420')).toBeTruthy()
})

it('allows every click, including double clicks, without waiting for previous purchases', () => {
  const view = room()
  const { rerender } = render(<ThrowBar room={view} playerId={self.id} />)
  expand()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } })
  const tomato = screen.getByRole('button', { name: 'Buy and throw Tomato for 100 coins' })
  act(() => {
    tomato.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    tomato.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  })
  expect(useGameStore.getState().throwItem).toHaveBeenCalledTimes(2)
  const updated = structuredClone(view)
  updated.players[0].balance = 400
  updated.game!.throws = [{ id: 1, item: 'TOMATO', playerId: self.id, targetId: other.id, cost: 100, fromEarnings: 0, fromWallet: 100 }]
  updated.game!.throwSpending = [{ playerId: self.id, amount: 100, fromEarnings: 0 }]
  rerender(<ThrowBar room={updated} playerId={self.id} />)
  fireEvent.click(tomato, { detail: 2 })
  expect(useGameStore.getState().throwItem).toHaveBeenCalledTimes(3)
  expect(screen.getByText('400')).toBeTruthy()
  fireEvent.click(tomato, { detail: 1 })
  expect(useGameStore.getState().throwItem).toHaveBeenCalledTimes(4)
})

it('hides the bar outside a live deal and for spectators; disconnect blocks purchases', () => {
  const { rerender } = render(<ThrowBar room={room({ game: game({ phase: 'FINISHED' }) })} playerId={self.id} />)
  expect(screen.queryByRole('complementary')).toBeNull()
  rerender(<ThrowBar room={room()} playerId="spectator" />)
  expect(screen.queryByRole('complementary')).toBeNull()
  rerender(<ThrowBar room={room()} playerId={self.id} />)
  expand()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: other.id } })
  act(() => useGameStore.setState({ connected: false }))
  expect(screen.getByRole('button', { name: 'Buy and throw Tomato for 100 coins' }).hasAttribute('disabled')).toBe(true)
})
