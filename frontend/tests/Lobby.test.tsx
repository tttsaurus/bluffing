import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import { useGameStore } from '../src/store'
import { room, self } from './fixtures'
import type { GameType } from '../src/types'

const initial = useGameStore.getState()
afterEach(() => { cleanup(); useGameStore.setState(initial, true) })

it('exposes a correctly labelled room-type dropdown and submits the selected game', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const createRoom = vi.fn().mockResolvedValue(undefined)
  useGameStore.setState({ player: self, bootstrapping: false, room: null, rooms: [], connected: true,
    createRoom, loadRooms: vi.fn().mockResolvedValue(undefined), loading: false, error: null })
  render(<App />)
  const dropdown = screen.getByRole('combobox', { name: 'ROOM TYPE' })
  expect(screen.getByRole('option', { name: "Liar's Deck 4 Fun Plus" })).toBeTruthy()
  await userEvent.selectOptions(dropdown, 'LIARS_DECK_PLUS')
  const name = screen.getByRole('textbox', { name: 'ROOM NAME' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Wildcard saloon')
  await userEvent.click(screen.getByRole('button', { name: /Create table/ }))
  expect(createRoom).toHaveBeenCalledWith('Wildcard saloon', 'LIARS_DECK_PLUS')
})

it('removes the marked lobby clutter while keeping room type, capacity and active count', () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  useGameStore.setState({ player: self, bootstrapping: false, room: null, connected: true,
    loadRooms: vi.fn().mockResolvedValue(undefined), rooms: [{ id: 'one', name: 'Quiet Club',
      gameType: 'LIARS_DECK_PLUS', status: 'LOBBY', hostId: self.id, playerCount: 4, maxPlayers: 8,
      activePlayerCount: 2, createdAt: '2026-10-01T00:00:00Z', joined: true }] })
  const { container } = render(<App />)
  for (const text of ['TABLE LOBBY', 'HOST A TABLE', 'CLASSIC', 'Open tables', 'Open', '1 room']) {
    expect(screen.queryByText(text, { exact: true })).toBeNull()
  }
  expect(screen.queryByText(/^Created /)).toBeNull()
  expect(container.querySelector('.profile > span:not(.profile-name)')).toBeNull()
  expect(screen.getByText("LIAR'S DECK PLUS")).toBeTruthy()
  expect(screen.getByText(/4\/8 players/)).toBeTruthy()
  expect(screen.getByText('2 active')).toBeTruthy()
})

function waitingRoom(plus = false) {
  const view = room({ status: 'LOBBY', game: null, gameType: plus ? 'LIARS_DECK_PLUS' : 'LIARS_DECK' })
  view.players.push({ ...view.players[1], id: 'away', displayName: 'Away member', presence: 'AWAY' },
    { ...view.players[1], id: 'offline', displayName: 'Offline member', presence: 'OFFLINE' })
  return view
}

it('lets the host deal with two present players and validates custom hands against only those two', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const startGame = vi.fn().mockResolvedValue(undefined)
  const view = waitingRoom()
  view.records = [{ playerId: self.id, displayName: self.displayName, identityTag: self.identityTag,
    wins: 1, currentStreak: 1, bestStreak: 1 }]
  useGameStore.setState({ player: self, bootstrapping: false, room: view, connected: true, loading: false, startGame })
  render(<App />)
  for (const text of ["LIAR'S DECK", 'Waiting room.', 'Back to open tables', 'SEATING ORDER', 'PER GAME',
    '2 here · 2 away/offline sitting out.', 'ROOM RECORDS', 'ALL-TIME', 'THE CHAMPIONS', 'THE HOT STREAKS',
    '✦ 1 live', 'YOUR COLLECTION · THIS ROOM', 'Your deck. Your turn. Everyone sees the show.', 'LIVE']) {
    expect(screen.queryByText(text, { exact: true })).toBeNull()
  }
  expect(screen.getByRole('region', { name: 'Players' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Game setup' })).toBeTruthy()
  expect(screen.getByText('GAME SETUP', { exact: true })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'House legends.' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Own the spotlight.' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /AUTO.*CUSTOM/ }))
  const count = screen.getByRole('spinbutton', { name: 'CARDS PER PLAYER' })
  await userEvent.clear(count); await userEvent.type(count, '20')
  expect(count.getAttribute('max')).toBe('26')
  const deal = screen.getByRole('button', { name: /Deal the cards/ })
  expect(deal.hasAttribute('disabled')).toBe(false)
  await userEvent.click(deal)
  expect(startGame).toHaveBeenCalledWith(1, 20, false)
  act(() => useGameStore.setState({ room: { ...view, players: view.players.map((member, index) => index === 1 ? { ...member, presence: 'AWAY' } : member) } }))
  expect(screen.getByRole('button', { name: /Need 2 players here/ }).hasAttribute('disabled')).toBe(true)
})

it.each<GameType>(['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'])('%s reuses classic game setup and the deck/avatar shop', async gameType => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const view = waitingRoom()
  view.gameType = gameType
  view.skins = [{ id: 'CLASSIC', name: 'House deck', effect: 'Engraved gold', price: 0, owned: true }]
  useGameStore.setState({ player: self, bootstrapping: false, room: view, connected: true, loading: false })
  render(<App />)
  expect(screen.getByRole('region', { name: 'Game setup' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Deal the cards/ })).toBeTruthy()
  expect(screen.getByText('House deck')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Avatars' })).toBeTruthy()
  expect(Boolean(screen.queryByRole('checkbox', { name: /Random decks/ }))).toBe(gameType === 'LIARS_DECK_PLUS' || gameType === 'LIARS_DECK_4FUN_PLUS')
})

it('Plus random decks use the participating count, not the number of durable seats', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const startGame = vi.fn().mockResolvedValue(undefined)
  useGameStore.setState({ player: self, bootstrapping: false, room: waitingRoom(true), connected: true, loading: false, startGame })
  render(<App />)
  await userEvent.click(screen.getByRole('checkbox', { name: /Random decks/ }))
  expect(screen.getByText(/A fresh roll of 1–2 decks/)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /AUTO.*CUSTOM/ }))
  const count = screen.getByRole('spinbutton', { name: 'CARDS PER PLAYER' })
  expect(count.getAttribute('max')).toBe('27')
  await userEvent.clear(count); await userEvent.type(count, '27')
  await userEvent.click(screen.getByRole('button', { name: /Deal the cards/ }))
  expect(startGame).toHaveBeenCalledWith(1, 27, true)
})
