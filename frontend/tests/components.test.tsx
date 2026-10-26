import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '../src/Modal'
import { Leaderboards } from '../src/Leaderboards'
import { PlayHistory, RoundFeedback, TurnOrder, Wallets } from '../src/GameFeedback'
import { useGameStore } from '../src/store'
import { game, other, outcome, room, self } from './fixtures'

beforeEach(() => useGameStore.setState({ room: room(), player: self, connected: true }))
afterEach(() => vi.useRealTimers())

describe('accessible dialogs', () => {
  it('opens with a label, ignores child clicks, and handles Escape/backdrop', () => {
    const onClose = vi.fn()
    render(<Modal label="Confirm stop" onClose={onClose}><button>Keep playing</button></Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Confirm stop' })
    expect(dialog.hasAttribute('open')).toBe(true)
    fireEvent.click(screen.getByRole('button'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes and restores focus to the initiating control on unmount', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<Modal label="Edit" onClose={vi.fn()}><input /></Modal>)
    const dialog = screen.getByRole('dialog')
    unmount()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('leaderboards', () => {
  it('shows empty records and hides entirely when no room is selected', () => {
    const { rerender } = render(<Leaderboards />)
    expect(screen.getByText('The crown is unclaimed.')).toBeTruthy()
    expect(screen.getByText('The first streak starts here.')).toBeTruthy()
    act(() => useGameStore.setState({ room: null }))
    rerender(<Leaderboards />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('keeps duplicate nicknames distinct and expands beyond the top five', async () => {
    const records = Array.from({ length: 6 }, (_, index) => ({ playerId: index === 0 ? self.id : `player-${index}`,
      displayName: 'Dealer', identityTag: `tag${index}`, wins: 6 - index, currentStreak: 1, bestStreak: 6 - index }))
    useGameStore.setState({ room: room({ records }) })
    render(<Leaderboards />)
    expect(screen.queryByText('THE CHAMPIONS', { exact: true })).toBeNull()
    expect(screen.queryByText('THE HOT STREAKS', { exact: true })).toBeNull()
    expect(screen.queryByText('✦ 1 live', { exact: true })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.queryAllByText('#tag5')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Show all records' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getAllByText('#tag5')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show top five' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
  })
})

describe('game UI', () => {
  it('keeps DOM seat order fixed and moves only the current-seat marker', () => {
    const snapshot = room()
    const { rerender } = render(<TurnOrder room={snapshot} playerId={self.id} connected />)
    const seats = screen.getAllByRole('listitem')
    expect(seats[0].getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('YOUR TURN')).toBeTruthy()
    rerender(<TurnOrder room={{ ...snapshot, game: game({ currentPlayerId: other.id }) }} playerId={self.id} connected />)
    expect(screen.getAllByRole('listitem')[0]).toBe(seats[0])
    expect(seats[1].getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('YOU’RE NEXT')).toBeTruthy()
    rerender(<TurnOrder room={snapshot} playerId={self.id} connected={false} />)
    expect(screen.getByText('CONNECTION LOST')).toBeTruthy()
  })

  it('moderators can kick a different player, never themselves', async () => {
    const kick = vi.fn().mockResolvedValue(undefined)
    useGameStore.setState({ kickPlayer: kick })
    render(<TurnOrder room={room()} playerId={self.id} connected />)
    await userEvent.click(screen.getByRole('button', { name: `Kick Dealer #${other.identityTag}` }))
    expect(kick).toHaveBeenCalledWith('room-one', other.id)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows pending risk separately and only animates a newly confirmed deposit', () => {
    const { rerender } = render(<Wallets room={room({ game: game({ pendingClaim: {
      playerId: self.id, cardCount: 2, generation: 1, risk: 20 } }) })} playerId={self.id} />)
    expect(screen.getByText('Your play is pending')).toBeTruthy()
    expect(screen.queryByText(/BANKED ✓/)).toBeNull()
    rerender(<Wallets room={room({ game: game({ earnings: [{ playerId: self.id, amount: 20 }], outcomes: [outcome()] }) })} playerId={self.id} />)
    expect(screen.getByText('+20 BANKED ✓')).toBeTruthy()
    expect(screen.getByText('Your play passed!')).toBeTruthy()
  })

  it('history respects server-private card faces and clears with an empty pool history', () => {
    const play = { id: 1, playerId: other.id, declaredRank: 'A', cardCount: 1, status: 'LIE' as const,
      challengerId: self.id, revealedCards: [{ id: 'card', rank: 'K', suit: 'HEARTS' as const }] }
    const { rerender } = render(<PlayHistory room={room({ game: game({ plays: [play] }) })} />)
    expect(screen.getByLabelText('Cards revealed to you')).toBeTruthy()
    expect(screen.getByText('K♥')).toBeTruthy()
    rerender(<PlayHistory room={room({ game: game({ plays: [{ ...play, revealedCards: [] }] }) })} />)
    expect(screen.queryByText('K♥')).toBeNull()
    expect(screen.getByLabelText('1 hidden cards')).toBeTruthy()
    rerender(<PlayHistory room={room({ game: game({ plays: [] }) })} />)
    expect(screen.getByText('No cards played yet.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('includes folds in newest-first history without inventing a card claim', () => {
    render(<PlayHistory room={room({ game: game({ poolSize: 0, actions: [
      { id: 1, type: 'PLAY', playerId: self.id, playId: 1, declaredRank: 'A', cardCount: 2 },
      { id: 2, type: 'FOLD', playerId: other.id, declaredRank: 'A', cardCount: 0 },
    ], plays: [{ id: 1, playerId: self.id, declaredRank: 'A', cardCount: 2, status: 'PASSED', revealedCards: [] }] }) })} />)
    const entries = screen.getAllByRole('listitem')
    expect(within(entries[0]).getByText('Folded')).toBeTruthy()
    expect(within(entries[0]).getByText('No cards played')).toBeTruthy()
    expect(within(entries[0]).queryByLabelText(/hidden cards/)).toBeNull()
    expect(within(entries[1]).getByText('2 × A')).toBeTruthy()
    expect(within(entries[1]).getByText('Accepted')).toBeTruthy()
  })

  it('does not replay old verdicts or show another player’s deposit notification', () => {
    useGameStore.setState({ room: room({ game: game({ outcomes: [outcome()] }) }) })
    render(<RoundFeedback />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => useGameStore.setState({ room: room({ game: game({ outcomes: [outcome({ id: 2, playerId: other.id, rewardPlayerId: other.id })] }) }) }))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => useGameStore.setState({ room: room({ game: game({ outcomes: [outcome({ id: 3 })] }) }) }))
    const verdict = screen.getByRole('status')
    expect(within(verdict).getByText('Your play passed!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss result' }))
  })

  it('shows challenged cards only in the initiating challenger’s verdict', () => {
    render(<RoundFeedback />)
    act(() => useGameStore.setState({ room: room({ game: game({ outcomes: [outcome({
      type: 'CHECK_SUCCEEDED', playerId: other.id, challengerId: self.id,
      revealedCards: [{ id: 'checked', rank: 'Q', suit: 'SPADES' }],
    })] }) }) }))
    expect(screen.getByText('Truth Check won!')).toBeTruthy()
    expect(screen.getByLabelText('Checked cards')).toBeTruthy()
    expect(screen.getByText('Q♠')).toBeTruthy()
  })
})
