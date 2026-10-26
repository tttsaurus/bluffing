import { expect, test, type Page } from '@playwright/test'
import { game, other, room, self } from '../tests/fixtures'

async function openHand(page: Page, count = 30) {
  const view = room({ game: game({ hand: Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`, rank: String(index % 9 + 2), suit: 'SPADES' as const,
  })), hands: [{ playerId: self.id, cardCount: count }, { playerId: other.id, cardCount: 5 }] }) })
  await page.goto('/')
  await page.evaluate(async ({ view, self }) => {
    const modulePath = '/src/store.ts'
    const { useGameStore } = await import(modulePath)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true,
      command: (action: string, ids: string[]) => { document.body.dataset.command = JSON.stringify({ action, ids }) },
    })
  }, { view, self })
  await expect(page.locator('[data-card-id]')).toHaveCount(count)
  await page.getByLabel('Your hand', { exact: true }).scrollIntoViewIfNeeded()
  return view
}
async function point(page: Page, index: number) {
  const box = (await page.locator(`[data-card-id="card-${index}"]`).boundingBox())!
  return { x: box.x + 12, y: box.y + box.height - 24 }
}
async function stroke(page: Page, from: number, to: number) {
  const start = await point(page, from), end = await point(page, to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
}
async function selected(page: Page) {
  return page.locator('.playing-card[aria-pressed="true"]').evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.cardId))
}

test('phone taps select and clear individual cards with and without drag mode', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Native taps require the phone profile')
  await openHand(page)
  const first = page.locator('[data-card-id="card-0"]')
  const second = page.locator('[data-card-id="card-1"]')
  await first.tap({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await second.tap({ position: { x: 12, y: 60 } })
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'PLAY 2', exact: true })).toBeEnabled()
  await first.tap({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Drag select', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Drag select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await first.tap({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await first.tap({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'false')
})

test('phone selection tolerates a finger drifting vertically during a tap', async ({ page, isMobile, context }) => {
  test.skip(!isMobile, 'Native touches require the phone profile')
  await openHand(page, 4)
  const cdp = await context.newCDPSession(page)
  const first = page.locator('[data-card-id="card-0"]')
  const drift = async (distance = 12) => {
    const bounds = (await first.boundingBox())!
    const touch = { x: bounds.x + 12, y: bounds.y + 40, id: 1 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, y: touch.y + distance }] })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await drift()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Drag select', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Drag select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await drift(24)
  await expect(first).toHaveAttribute('aria-pressed', 'false')
})

test('phone taps near the bottom edge keep the original card as the touch target', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Native taps require the phone profile')
  await openHand(page, 4)
  const first = page.locator('[data-card-id="card-0"]')
  const bounds = (await first.boundingBox())!
  await first.tap({ position: { x: 12, y: bounds.height - 2 } })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
})

test('drag selects ranges in either direction, paints each card once, and preserves clicks and keyboard selection', async ({ page }) => {
  await openHand(page)
  const first = page.locator('[data-card-id="card-0"]')
  await first.click({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await first.click({ position: { x: 12, y: 60 } })
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await stroke(page, 0, 3)
  expect(await selected(page)).toEqual(['card-0', 'card-1', 'card-2', 'card-3'])
  await expect(page.getByRole('button', { name: 'PLAY 4', exact: true })).toBeEnabled()
  await stroke(page, 3, 1)
  expect(await selected(page)).toEqual(['card-0'])
  const start = await point(page, 1), end = await point(page, 3)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.move(start.x, start.y, { steps: 8 })
  await page.mouse.up()
  expect(await selected(page)).toEqual(['card-0', 'card-1', 'card-2', 'card-3'])
  await first.focus()
  await page.keyboard.press('Space')
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Enter')
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'PLAY 4', exact: true }).click()
  expect(await page.locator('body').getAttribute('data-command')).toBe(JSON.stringify({ action: 'PLAY', ids: ['card-1', 'card-2', 'card-3', 'card-0'] }))
})

test('edge dragging scrolls through a long hand and selects cards skipped between pointer events', async ({ page }) => {
  await openHand(page, 30)
  const start = await point(page, 0)
  const hand = (await page.getByLabel('Your hand', { exact: true }).boundingBox())!
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(hand.x + hand.width - 1, start.y, { steps: 2 })
  await expect.poll(async () => (await selected(page)).length, { timeout: 10_000 }).toBe(30)
  await page.mouse.up()
  await expect(page.locator('.hand-selected-count')).toHaveText('30 selected')
  expect(await page.getByLabel('Your hand', { exact: true }).evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
})

test('dragging past the last card includes the end of a short centered hand', async ({ page }) => {
  await openHand(page, 4)
  const start = await point(page, 0)
  const hand = (await page.getByLabel('Your hand', { exact: true }).boundingBox())!
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(hand.x + hand.width - 1, start.y, { steps: 2 })
  await page.mouse.up()
  expect(await selected(page)).toEqual(['card-0', 'card-1', 'card-2', 'card-3'])
})

test('Escape rolls back a drag and a turn change stops selection', async ({ page }) => {
  const view = await openHand(page)
  const start = await point(page, 0), end = await point(page, 3)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  expect((await selected(page)).length).toBeGreaterThan(1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await selected(page)).toEqual([])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.evaluate(async view => {
    const modulePath = '/src/store.ts'
    const { useGameStore } = await import(modulePath)
    useGameStore.setState({ room: { ...view, game: { ...view.game!, currentPlayerId: 'two' } } })
  }, view)
  await page.mouse.move(start.x, start.y)
  await page.mouse.up()
  expect(await selected(page)).toEqual([])
  await expect(page.locator('[data-card-id="card-0"]')).toBeDisabled()
  await stroke(page, 0, 3)
  expect(await selected(page)).toEqual([])
})

test('touch swipes scroll normally and Drag select enables touch range selection', async ({ page, isMobile, context }) => {
  test.skip(!isMobile, 'Touch gesture on the mobile device profile')
  await openHand(page)
  const cdp = await context.newCDPSession(page)
  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10, id: 1 }] })
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const hand = page.getByLabel('Your hand', { exact: true })
  const bounds = (await hand.boundingBox())!
  await swipe({ x: bounds.x + bounds.width - 40, y: bounds.y + bounds.height - 32 }, { x: bounds.x + 50, y: bounds.y + bounds.height - 32 })
  await expect.poll(() => hand.evaluate(element => element.scrollLeft)).toBeGreaterThan(20)
  expect(await selected(page)).toEqual([])
  // Wait for the native swipe's inertia; a tap during coasting first stops it.
  let previous = -1, stable = 0
  await expect.poll(async () => {
    const position = await hand.evaluate(element => element.scrollLeft)
    stable = Math.abs(position - previous) < 1 ? stable + 1 : 0
    previous = position
    return stable
  }).toBeGreaterThanOrEqual(2)
  await hand.evaluate(element => { element.scrollLeft = 0 })
  await page.getByRole('button', { name: 'Drag select', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Drag select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await hand.scrollIntoViewIfNeeded()
  await swipe(await point(page, 0), await point(page, 3))
  expect(await selected(page)).toEqual(['card-0', 'card-1', 'card-2', 'card-3'])
  await expect(page.getByRole('button', { name: 'Drag select', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('touch-mass-selection.png'), fullPage: true })
})
