import { expect, test, type Page } from '@playwright/test'
import type { Player, RoomView } from '../src/types'
import { gameModes, suitSymbols } from '../src/gameModes'
import { randomBytes } from 'node:crypto'

async function identity(page: Page) {
  return page.evaluate(() => ({
    player: JSON.parse(localStorage.getItem('bluff-table-player')!) as Player,
    token: localStorage.getItem('bluff-table-device-token')!,
  }))
}

async function enter(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel('PLAYER NAME', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Take a seat' }).click()
  await expect(page.getByRole('button', { name: 'Create table' })).toBeVisible()
  await expect(page.getByText('Reconnecting to the live table…')).toHaveCount(0)
  return identity(page)
}

test('persistent identity supports duplicate names and nickname edits', async ({ page, browser }) => {
  const first = await enter(page, 'Same nickname')
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const second = await enter(await secondContext.newPage(), 'Same nickname')
    expect(second.player.displayName).toBe(first.player.displayName)
    expect(second.player.id).not.toBe(first.player.id)
    expect(second.player.identityTag).not.toBe(first.player.identityTag)
  } finally { await secondContext.close() }

  await page.getByRole('button', { name: /Same nickname/ }).click()
  await page.getByLabel('NICKNAME', { exact: true }).fill('Renamed player')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: /Renamed player/ })).toBeVisible()
  expect((await identity(page)).player.id).toBe(first.player.id)
  expect((await identity(page)).token).toBe(first.token)
})

for (const gameType of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'] as const) {
test(`two browsers create, join, play, truth-check privately and stop ${gameType}`, async ({ page, browser }) => {
  const mode = gameModes[gameType]
  const plus = mode.ruleHints.includes('plus')
  const spelling = mode.ruleHints.includes('spelling')
  const host = await enter(page, 'CI dealer')
  const roomName = `CI ${gameType === 'LIARS_DECK_PLUS' ? 'Plus' : 'Classic'} ${Date.now()}`
  let roomId: string | undefined
  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    await page.getByLabel('ROOM NAME', { exact: true }).fill(roomName)
    await page.getByLabel('ROOM TYPE', { exact: true }).selectOption(gameType)
    await page.getByRole('button', { name: 'Create table' }).click()
    await expect(page.getByRole('region', { name: 'Players' })).toBeVisible()
    const listing = await page.request.get('/api/rooms', { headers: { Authorization: `Bearer ${host.token}` } })
    roomId = (await listing.json()).find((entry: { name: string }) => entry.name === roomName).id
    await expect(page.getByText('THIS GAME', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Avatars', exact: true }).click()
    await page.getByRole('button', { name: 'Equip for free', exact: true }).click()
    await expect(page.locator('.player-row .avatar img')).toHaveCount(1)
    const waitingAvatar = await page.locator('.player-row .avatar img').boundingBox()
    expect(waitingAvatar!.width).toBeLessThanOrEqual(50)
    expect(waitingAvatar!.height).toBeLessThanOrEqual(50)

    // Durable seats must not block a deal while those accounts are offline.
    for (const displayName of ['CI absent one', 'CI absent two']) {
      const token = randomBytes(32).toString('hex')
      const account = await page.request.post('/api/players', { data: { displayName, deviceToken: token } })
      expect(account.ok()).toBe(true)
      const join = await page.request.post(`/api/rooms/${roomId}/join`, { headers: { Authorization: `Bearer ${token}` } })
      expect(join.ok()).toBe(true)
    }
    await expect(page.getByText('OFFLINE', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: /Need 2 players here/ })).toBeDisabled()

    const guestPage = await guestContext.newPage()
    const guest = await enter(guestPage, 'CI guest')
    await expect(guestPage.getByText('TABLE LOBBY', { exact: true })).toHaveCount(0)
    await expect(guestPage.getByText('Open tables', { exact: true })).toHaveCount(0)
    await expect(guestPage.getByText('Open', { exact: true })).toHaveCount(0)
    await guestPage.screenshot({ path: test.info().outputPath('lobby-clean.png'), fullPage: true })
    await guestPage.getByRole('article').filter({ has: guestPage.getByRole('heading', { name: roomName, exact: true }) })
      .getByRole('button', { name: 'Join table' }).click()
    await expect(guestPage.getByRole('region', { name: 'Players' })).toBeVisible()
    await expect(guestPage.getByText('GAME SETUP', { exact: true })).toHaveCount(0)
    await expect(page.getByText('HERE', { exact: true })).toHaveCount(2)
    if (mode.randomDecks) {
      await page.getByRole('checkbox', { name: /Random decks/ }).check()
      await expect(guestPage.getByRole('checkbox', { name: /Random decks/ })).toHaveCount(0)
    } else {
      await expect(page.getByRole('checkbox', { name: /Random decks/ })).toHaveCount(0)
      await page.getByRole('button', { name: /AUTO.*CUSTOM/ }).click()
      await page.getByLabel('CARDS PER PLAYER').fill('3')
    }
    await page.getByRole('button', { name: 'Deal the cards' }).click()
    await expect(page.getByRole('list', { name: 'Players around the table' })).toBeVisible()
    await expect(guestPage.getByRole('list', { name: 'Players around the table' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop deal' })).toBeVisible()
    await expect(page.locator('.table-seat.current .seat-thinking')).toContainText('THINKING')
    const wallet = await page.getByRole('complementary', { name: 'Reward and wallet' }).boundingBox()
    const hand = await page.getByLabel('Your hand', { exact: true }).boundingBox()
    expect(wallet!.y).toBeGreaterThanOrEqual(hand!.y + hand!.height)
    await page.screenshot({ path: test.info().outputPath('avatar-table.png'), fullPage: true })

    const snapshot = async (token: string): Promise<RoomView> => {
      const response = await page.request.get(`/api/rooms/${roomId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } })
      expect(response.ok()).toBe(true)
      return response.json()
    }
    const initial = await snapshot(host.token)
    expect(initial.gameType).toBe(gameType)
    expect(initial.players).toHaveLength(4)
    expect(initial.game!.participants).toEqual(expect.arrayContaining([host.player.id, guest.player.id]))
    expect(initial.game!.participants).toHaveLength(2)
    if (plus) {
      expect(initial.game!.deckCount).toBeGreaterThanOrEqual(1)
      expect(initial.game!.deckCount).toBeLessThanOrEqual(2)
      expect(initial.game!.cardsPerPlayer).toBe(initial.game!.deckCount * 27)
      const guestView = await snapshot(guest.token)
      const jokerCount = [...initial.game!.hand, ...guestView.game!.hand].filter(card => card.rank === 'JOKER').length
      expect(jokerCount).toBe(initial.game!.deckCount * 2)
      expect(await page.getByRole('button', { name: 'Joker (wild card)', exact: true }).count()
        + await guestPage.getByRole('button', { name: 'Joker (wild card)', exact: true }).count()).toBe(jokerCount)
      await page.getByRole('button', { name: /Expand reward panel/ }).click()
      await page.getByText('Game rules & selection hints', { exact: true }).click()
      await expect(page.getByText('4-card straight → 4 × a rank inside it', { exact: true })).toBeVisible()
      await expect(page.getByText('Ace can be low (A-2-3-4) or high (J-Q-K-A), never wraparound', { exact: true })).toBeVisible()
      await page.screenshot({ path: test.info().outputPath('plus-table.png'), fullPage: true })
      await page.getByRole('button', { name: /Collapse reward panel/ }).click()
    }
    const [actor, checker, actorToken, checkerToken] = initial.game!.currentPlayerId === host.player.id
      ? [page, guestPage, host.token, guest.token] : [guestPage, page, guest.token, host.token]
    const before = await snapshot(actorToken)
    const card = spelling ? before.game!.hand.find(card => card.rank === 'SPELL')! : before.game!.hand[0]
    // Multiple physical decks intentionally contain identical rank/suit labels.
    await actor.getByRole('button', { name: card.rank === 'SPELL' ? 'Spell card' : `${card.rank} of ${card.suit.toLowerCase()}`, exact: true }).first().click()
    await actor.getByRole('button', { name: /^PLAY / }).click()
    await expect(checker.getByRole('button', { name: /^TRUTH CHECK/ })).toBeEnabled()
    await checker.getByRole('button', { name: /^TRUTH CHECK/ }).click()
    await expect.poll(async () => (await snapshot(checkerToken)).game!.plays!.at(-1)!.status).not.toBe('PENDING')
    const checked = await snapshot(checkerToken)
    const defended = await snapshot(actorToken)
    expect(checked.game!.plays!.at(-1)!.revealedCards).toHaveLength(1)
    expect(defended.game!.plays!.at(-1)!.revealedCards).toHaveLength(0)
    if (spelling) {
      for (const viewer of [actor, checker]) {
        await expect(viewer.getByRole('dialog', { name: 'Spelling challenge' })).toBeVisible()
        await viewer.getByLabel('YOUR SPELLING', { exact: true }).fill('intentionallywrong')
      }
      await actor.getByRole('button', { name: 'Submit', exact: true }).click()
      // The other player's latest draft must settle automatically at the server deadline.
      for (const viewer of [actor, checker]) {
        await expect(viewer.getByRole('heading', { name: 'The verdict is in.' })).toBeVisible({ timeout: 20_000 })
        await viewer.getByRole('button', { name: 'Back to the table', exact: true }).click()
      }
      expect((await snapshot(host.token)).game!.spelling!.stage).toBe('COMPLETE')
    }
    await checker.locator('.history-menu > summary').click()
    const revealed = checker.getByRole('region', { name: 'Recent plays' }).getByLabel('Cards revealed to you')
    await expect(revealed).toHaveCount(2)
    for (const entry of await revealed.all()) {
      await expect(entry.getByText(`${card.rank}${suitSymbols[card.suit]}`, { exact: true })).toBeVisible()
    }
    await checker.locator('.history-menu > summary').click()
    await actor.locator('.history-menu > summary').click()
    await expect(actor.getByRole('region', { name: 'Recent plays' }).getByLabel('Cards revealed to you')).toHaveCount(0)
    await actor.locator('.history-menu > summary').click()

    // Dismiss the result overlay before opening the moderator dialog.
    for (const viewer of [page, guestPage]) {
      const dismiss = viewer.getByRole('button', { name: 'Dismiss result' })
      if (await dismiss.isVisible()) await dismiss.click()
    }
    await page.getByRole('button', { name: 'Stop deal' }).click()
    await page.getByRole('button', { name: 'Stop & restore wallets' }).click()
    await expect(page.getByRole('region', { name: 'Players' })).toBeVisible()
    await expect(guestPage.getByRole('region', { name: 'Players' })).toBeVisible()
    const stopped = await snapshot(host.token)
    expect(stopped.players.map(player => player.balance)).toEqual([0, 0, 0, 0])
    // The document itself must not overflow on the mobile viewport.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  } finally {
    await guestContext.close()
    if (roomId) {
      const deleted = await page.request.delete(`/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${host.token}` } })
      expect(deleted.status()).toBe(204)
    }
  }
})
}
