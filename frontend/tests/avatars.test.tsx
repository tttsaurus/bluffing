import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DeckShop } from '../src/DeckShop'
import { TableSeats } from '../src/TableActivity'
import { useGameStore } from '../src/store'
import { room, self } from './fixtures'

it('equips the free cat from the avatar category and renders the public equipment at the table', () => {
  const view = room({ status: 'LOBBY' })
  const changeAvatar = vi.fn()
  useGameStore.setState({ room: view, player: self, connected: true, loading: false, changeAvatar })
  const shop = render(<DeckShop />)
  fireEvent.click(screen.getByRole('button', { name: 'Avatars' }))
  expect(screen.getByAltText('Boxing cat').getAttribute('src')).toBe('/avatars/boxing-cat.png')
  fireEvent.click(screen.getByRole('button', { name: 'Equip for free' }))
  expect(changeAvatar).toHaveBeenCalledWith('BOXING_CAT')
  const equipped = { ...view, players: view.players.map(p => p.id === self.id ? { ...p, equippedAvatar: 'BOXING_CAT' as const } : p) }
  act(() => useGameStore.setState({ room: equipped }))
  expect(within(screen.getByText('Boxing Cat').closest('article')!).getByRole('button').hasAttribute('disabled')).toBe(true)
  shop.unmount()
  render(<TableSeats room={equipped} playerId="two" />)
  expect(document.querySelector('.seat-avatar img')?.getAttribute('src')).toBe('/avatars/boxing-cat.png')
  expect(document.querySelectorAll('.seat-avatar svg')).toHaveLength(1)
})

it('confirms the 500-point purchase and blocks the 5000-point avatar when funds are insufficient', () => {
  const changeAvatar = vi.fn()
  useGameStore.setState({ room: room({ status: 'LOBBY', avatars: [
    { id: 'PORTRAIT', name: '(look)', price: 500, owned: false },
    { id: 'GREEN_CHARACTER', name: 'mimimi', price: 5000, owned: false },
  ] }), player: self, connected: true, loading: false, changeAvatar })
  render(<DeckShop />)
  fireEvent.click(screen.getByRole('button', { name: 'Avatars' }))
  expect(screen.getByAltText('mimimi').getAttribute('src')).toBe('/avatars/green-character.gif')
  expect(screen.getByRole('button', { name: 'Unlock · ◆ 5,000' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Unlock · ◆ 500' }))
  expect(changeAvatar).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Buy & equip' }))
  expect(changeAvatar).toHaveBeenCalledWith('PORTRAIT', true)
})
