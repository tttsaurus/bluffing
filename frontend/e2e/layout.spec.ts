import { expect, test } from '@playwright/test'
import { game, room, self } from '../tests/fixtures'
import type { Card } from '../src/types'

test('eight avatar seats, duplicate identity tags, wallet and hand remain usable', async ({ page }) => {
  const players = Array.from({ length: 8 }, (_, index) => ({
    ...room().players[0], id: index === 0 ? self.id : `player-${index}`,
    displayName: 'Same nickname', identityTag: `tag0${index}`, seatIndex: index, host: index === 0,
    equippedAvatar: 'BOXING_CAT' as const,
  }))
  const view = room({ gameType: 'LIARS_DECK_PLUS', players, game: game({
    currentPlayerId: self.id, lastNonFoldedPlayerId: 'player-3',
    hand: Array.from({ length: 26 }, (_, index): Card => ({ id: `card-${index}`, rank: 'A', suit: 'SPADES' })),
    hands: players.map(player => ({ playerId: player.id, cardCount: 26 })),
  }) })
  await page.goto('/')
  await page.evaluate(async ({ view, self }) => {
    const modulePath = '/src/store.ts'
    const { useGameStore } = await import(modulePath)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true })
  }, { view, self })
  const seats = page.getByRole('list', { name: 'Players around the table' })
  await expect(seats.locator('.seat-avatar')).toHaveCount(8)
  for (const player of players) await expect(seats.getByText(`#${player.identityTag}`, { exact: true })).toBeVisible()
  await expect(seats.locator('.current .seat-thinking')).toContainText('THINKING')
  await expect(seats.locator('.current .thinking-dots i')).toHaveCount(3)
  const thinking = (await seats.locator('.self .seat-thinking').boundingBox())!
  expect(thinking.x).toBeGreaterThanOrEqual(0)
  expect(thinking.x + thinking.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await expect(seats.locator('.last-non-folded')).toContainText('#tag03')
  await expect(page.getByRole('button', { name: 'Stop deal' })).toBeVisible()
  const hand = await page.getByLabel('Your hand', { exact: true }).boundingBox()
  const firstCard = await page.getByRole('button', { name: 'A of spades', exact: true }).first().boundingBox()
  expect(firstCard!.x).toBeGreaterThanOrEqual(hand!.x)
  const pool = await page.locator('.pool').boundingBox()
  const topName = await seats.locator('.table-seat').nth(4).locator('strong').boundingBox()
  expect(pool!.y).toBeGreaterThanOrEqual(topName!.y + topName!.height)
  const selfAvatar = await seats.locator('.self .seat-avatar').boundingBox()
  if (page.viewportSize()!.width <= 600) {
    const neighborName = (await seats.locator('.table-seat').nth(1).locator('strong').boundingBox())!
    expect(selfAvatar!.y).toBeGreaterThanOrEqual(neighborName.y + neighborName.height)
  }
  const rankPicker = await page.getByRole('combobox', { name: 'DECLARE AS' }).boundingBox()
  expect(rankPicker!.x).toBeGreaterThanOrEqual(selfAvatar!.x + selfAvatar!.width)
  for (const label of await seats.locator('.table-seat:not(.self) > strong').all()) {
    const name = (await label.boundingBox())!
    expect(rankPicker!.y).toBeGreaterThanOrEqual(name.y + name.height)
  }
  if (page.viewportSize()!.width <= 900) {
    const header = await page.locator('.table-header').boundingBox()
    const announcement = await page.locator('.table-play-empty').boundingBox()
    expect(announcement!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
  }
  const board = await page.getByRole('complementary', { name: 'Reward and wallet' }).boundingBox()
  expect(board!.y).toBeGreaterThanOrEqual(hand!.y + hand!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('eight-seat-layout.png'), fullPage: true })
  await page.evaluate(async () => {
    const modulePath = '/src/store.ts'
    const { useGameStore } = await import(modulePath)
    useGameStore.setState({ connected: false })
  })
  await expect(page.getByRole('button', { name: 'RECONNECT ↻' })).toBeVisible()
})
