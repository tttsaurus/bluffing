import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WaitingRoomNotice, clearTableResetNotice } from '../src/WaitingRoomNotice'
import { game, room, self, other } from './fixtures'

function waiting(notice = 'Wallets restored.') {
  return room({ id: crypto.randomUUID(), status: 'LOBBY', game: null, notice })
}

it('consumes a reset notice when shown and does not replay it on re-entry', () => {
  const view = waiting()
  render(<StrictMode><WaitingRoomNotice room={view} playerId={self.id} /></StrictMode>)
  expect(screen.getByText('■ Table reset')).toBeTruthy()
  cleanup()
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows a new finished deal but never replays a previously shown result', () => {
  const view = waiting()
  view.notice = null
  view.game = game({ phase: 'FINISHED', winnerId: self.id })
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.getByText(/won the deal/)).toBeTruthy()
  cleanup()
  const { rerender } = render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.queryByRole('status')).toBeNull()
  rerender(<WaitingRoomNotice room={{ ...view, game: { ...view.game, gameId: 'next-deal' } }} playerId={self.id} />)
  expect(screen.getByText(/won the deal/)).toBeTruthy()
})

it('can show the same reset copy after a later deal, and keeps receipts per player and room', () => {
  const view = waiting()
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  cleanup()
  render(<WaitingRoomNotice room={view} playerId={other.id} />)
  expect(screen.getByRole('status')).toBeTruthy()
  cleanup()
  clearTableResetNotice(view.id, self.id)
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.getByRole('status')).toBeTruthy()
  cleanup()
  render(<WaitingRoomNotice room={{ ...view, id: 'another-room' }} playerId={self.id} />)
  expect(screen.getByRole('status')).toBeTruthy()
})

it('does not duplicate the reset and finished banners for one abandoned deal', () => {
  const view = waiting()
  view.game = game({ phase: 'FINISHED', winnerId: null })
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByText('Deal ended · not enough players')).toBeTruthy()
  expect(screen.getByText('Wallets restored.')).toBeTruthy()
})

it('deduplicates when session storage cannot be written', () => {
  const view = waiting()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage quota') })
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.getByRole('status')).toBeTruthy()
  cleanup()
  render(<WaitingRoomNotice room={view} playerId={self.id} />)
  expect(screen.queryByRole('status')).toBeNull()
})
