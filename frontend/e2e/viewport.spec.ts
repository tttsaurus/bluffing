import { expect, test } from '@playwright/test'
import { game, room, self } from '../tests/fixtures'

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`table stays in its viewport and floating panels remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const players = Array.from({ length: 8 }, (_, index) => ({ ...room().players[0], id: index ? `player-${index}` : self.id,
      identityTag: `tag${index}`, displayName: 'Same name', seatIndex: index }))
    const view = room({ gameType: 'LIARS_DECK_4FUN_PLUS', players, game: game({
      hand: Array.from({ length: 26 }, (_, index) => ({ id: `card-${index}`, rank: 'A', suit: 'SPADES' as const })),
      hands: players.map(player => ({ playerId: player.id, cardCount: 26 })),
    }) })
    await page.goto('/')
    await page.evaluate(async ({ view, self }) => {
      const path = '/src/store.ts'
      const { useGameStore } = await import(path)
      useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true })
    }, { view, self })
    await expect(page.getByRole('button', { name: /Expand reward panel/ })).toBeVisible()
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
    expect(size.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(size.height).toBeLessThanOrEqual(viewport.height + 1)
    const hand = (await page.getByLabel('Your hand', { exact: true }).boundingBox())!
    const docks = (await page.locator('.table-docks').boundingBox())!
    expect(hand.x).toBeGreaterThanOrEqual(0)
    expect(hand.x + hand.width).toBeLessThanOrEqual(viewport.width)
    expect(hand.y).toBeGreaterThanOrEqual(0)
    expect(hand.y + hand.height).toBeLessThanOrEqual(docks.y)
    for (const identity of await page.locator('.table-seat > strong').all()) {
      const bounds = (await identity.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    }
    await page.getByRole('button', { name: 'A of spades', exact: true }).first().click()
    await page.getByRole('button', { name: /Expand reward panel/ }).click()
    await expect(page.getByLabel('Potential reward: generation 1 times 1 cards, 10 coins')).toBeVisible()
    const reward = (await page.locator('.reward-dock-panel').boundingBox())!
    expect(reward.y).toBeGreaterThanOrEqual(0)
    expect(reward.x).toBeGreaterThanOrEqual(0)
    expect(reward.x + reward.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: test.info().outputPath('reward-panel.png') })
    await page.getByRole('button', { name: /Expand throwing bar/ }).click()
    await expect(page.locator('.reward-dock-panel')).toBeHidden()
    await expect(page.getByRole('combobox', { name: 'Throw at' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Throw at' }).press('Escape')
    await expect(page.getByRole('combobox', { name: 'Throw at' })).toBeHidden()
    await page.mouse.wheel(0, 500)
    expect(await page.evaluate(() => scrollY)).toBe(0)
    await page.screenshot({ path: test.info().outputPath('fixed-table.png') })
    await page.evaluate(async view => {
      const path = '/src/store.ts'
      const { useGameStore } = await import(path)
      useGameStore.setState({ room: { ...view, game: { ...view.game!, targetRank: 'Q', poolSize: 2 } } })
    }, view)
    const rank = (await page.getByRole('status', { name: 'Current rank: Q' }).boundingBox())!
    const felt = (await page.locator('.felt').boundingBox())!
    expect(rank.y + rank.height).toBeLessThanOrEqual(felt.y + felt.height)
    await page.screenshot({ path: test.info().outputPath('current-rank.png') })
    await page.evaluate(async view => {
      const path = '/src/store.ts'
      const { useGameStore } = await import(path)
      useGameStore.setState({ room: { ...view, status: 'LOBBY', game: null } })
    }, view)
    await expect(page.getByRole('region', { name: 'Game setup' })).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden')
  })
}
