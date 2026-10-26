import { expect, test, type WebSocketRoute } from '@playwright/test'
import { game, room, self, other } from '../tests/fixtures'
import type { RoomView } from '../src/types'

test('4 Fun Plus is a separate room choice with both rules, setup and spelling UI', async ({ page }) => {
  let view: RoomView = room({ gameType: 'LIARS_DECK_4FUN_PLUS', status: 'LOBBY', game: null })
  let socket: WebSocketRoute | undefined
  const commands: { action: string; answer?: string }[] = []
  const broadcast = () => socket?.send(JSON.stringify({ type: 'ROOM_STATE', payload: view }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    let json: unknown = []
    if (path.startsWith('/api/players')) json = self
    if (path === '/api/rooms' && request.method() === 'POST') {
      expect(request.postDataJSON()).toMatchObject({ name: 'Combined saloon', gameType: 'LIARS_DECK_4FUN_PLUS' })
      json = view
    }
    if (path.endsWith('/start')) {
      expect(request.postDataJSON()).toEqual({ deckCount: 1, cardsPerPlayer: 3, randomDeckCount: true })
      view = { ...view, status: 'IN_GAME', game: game({ cardsPerPlayer: 3, hand: [
        { id: 'ace', rank: 'A', suit: 'SPADES' }, { id: 'two', rank: '2', suit: 'SPADES' },
        { id: 'joker', rank: 'JOKER', suit: 'JOKER' }, { id: 'spell', rank: 'SPELL', suit: 'SPADES' },
      ], hands: [self, other].map(player => ({ playerId: player.id, cardCount: 4 })) }) }
      json = view
      broadcast()
    }
    await route.fulfill({ json, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.routeWebSocket('**/ws', connection => {
    socket = connection
    connection.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.type === 'AUTH') connection.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId: self.id } }))
      if (message.type === 'SYNC_ROOM') broadcast()
      if (message.type === 'GAME_COMMAND') commands.push(message.payload)
    })
  })
  await page.goto('/')
  await page.getByLabel('PLAYER NAME', { exact: true }).fill(self.displayName)
  await page.getByRole('button', { name: 'Take a seat' }).click()
  const types = page.getByRole('combobox', { name: 'ROOM TYPE' })
  await expect(types.locator('option')).toHaveCount(4)
  await types.selectOption('LIARS_DECK_4FUN_PLUS')
  await page.getByRole('textbox', { name: 'ROOM NAME' }).fill('Combined saloon')
  await page.getByRole('button', { name: /Create table/ }).click()
  await expect(page.getByText('Jokers and SPELL are wild')).toBeVisible()
  await expect(page.getByText('Truth-checking a single SPELL card starts a 15-second challenge')).toBeVisible()
  await page.getByRole('checkbox', { name: /Random decks/ }).check()
  await page.getByRole('button', { name: /AUTO.*CUSTOM/ }).click()
  const count = page.getByRole('spinbutton', { name: 'CARDS PER PLAYER' })
  await expect(count).toHaveAttribute('max', '27')
  await count.fill('3')
  await page.getByRole('button', { name: /Deal the cards/ }).click()
  for (const name of ['A of spades', '2 of spades', 'Joker (wild card)', 'Spell card']) {
    await page.getByRole('button', { name, exact: true }).click()
  }
  await page.getByRole('button', { name: /Expand reward panel/ }).click()
  await page.getByText('Game rules & selection hints', { exact: true }).click()
  await expect(page.getByText('Straight ready')).toBeVisible()
  await expect(page.getByText('Truthful as: A · 2 · 3 · 4')).toBeVisible()
  await expect(page.locator('.turn-aura, .shader-surface')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('combined-mode.png'), fullPage: true })
  const now = Date.now()
  view = { ...view, game: { ...view.game!, spelling: {
    id: 'combined-spelling', stage: 'ACTIVE', serverNow: now, deadline: now + 15000, penalty: 1,
    audioUrl: '/api/spelling/audio/fixture', submitted: false, submittedCount: 0, playerCount: 2, results: [],
  } } }
  broadcast()
  await expect(page.getByRole('dialog', { name: 'Spelling challenge' })).toBeVisible()
  await page.getByLabel('YOUR SPELLING', { exact: true }).fill('quiet')
  await page.getByRole('button', { name: /Submit/ }).click()
  await expect.poll(() => commands.some(command => command.action === 'SPELL_ANSWER' && command.answer === 'quiet')).toBe(true)
  view = { ...view, game: { ...view.game!, spelling: { ...view.game!.spelling!, stage: 'COMPLETE', results: [
    { playerId: other.id, word: 'quiet', answer: 'quiet', correct: true, drawn: 0 },
    { playerId: self.id, word: 'quiet', answer: 'wrong', correct: false, drawn: 1 },
  ] } } }
  broadcast()
  const correct = page.locator('.spelling-results > div').filter({ hasText: `#${other.identityTag}` })
  const wrong = page.locator('.spelling-results > div').filter({ hasText: `#${self.identityTag}` })
  await expect(correct).toContainText('✓ Correct')
  await expect(correct).not.toContainText('+1 cards')
  await expect(wrong).toContainText('+1 cards')
  await page.screenshot({ path: test.info().outputPath('spelling-penalties.png') })
})
