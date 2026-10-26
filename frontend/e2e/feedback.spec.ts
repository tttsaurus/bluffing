import { expect, test, type Page } from '@playwright/test'
import { game, other, outcome, room, self } from '../tests/fixtures'
import type { RoomView } from '../src/types'

async function show(page: Page, view: RoomView) {
  await page.evaluate(async ({ view, self }) => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true })
  }, { view, self })
}

test('successive in-game verdicts stay anchored without stacking or moving the table', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await show(page, room())
  await expect(page.locator('.felt')).toBeVisible()
  const passed = outcome()
  await show(page, room({ game: game({ outcomes: [passed] }) }))
  await expect(page.getByRole('heading', { name: 'Your play passed!' })).toBeVisible()
  await expect(page.locator('.verdict-card')).toHaveCSS('opacity', '1')
  const defended = outcome({ id: 2, type: 'CHECK_FAILED', challengerId: other.id, amount: 40 })
  const view = room({ game: game({ outcomes: [passed, defended] }) })
  const frames = await page.evaluate(async view => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    const table = document.querySelector('.felt')!
    const original = table.getBoundingClientRect()
    useGameStore.setState({ room: view })
    return new Promise<{ top: number; offset: number; tableShift: number }[]>(resolve => {
      const frames: { top: number; offset: number; tableShift: number }[] = []
      const started = performance.now()
      function sample() {
        const anchor = document.querySelector('.verdict-layer')!.getBoundingClientRect().top
        const cards = [...document.querySelectorAll('.verdict-card')]
        for (const card of cards) {
          const top = card.getBoundingClientRect().top
          frames.push({ top, offset: top - anchor, tableShift: Math.abs(table.getBoundingClientRect().top - original.top) })
        }
        if (performance.now() - started < 1200) requestAnimationFrame(sample)
        else resolve(frames)
      }
      requestAnimationFrame(sample)
    })
  }, view)
  expect(frames.length).toBeGreaterThan(3)
  expect(Math.max(...frames.map(frame => frame.offset))).toBeLessThanOrEqual(1)
  expect(Math.max(...frames.map(frame => frame.tableShift))).toBeLessThanOrEqual(1)
  await expect(page.getByRole('heading', { name: 'Truth defended!' })).toBeVisible()
  await expect(page.locator('.verdict-card')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('truth-defended.png') })
  const before = await page.locator('.felt').boundingBox()
  await expect(page.locator('.verdict-card')).toHaveCount(0)
  expect(await page.locator('.felt').boundingBox()).toEqual(before)
})

test('a verdict received during dismissal appears in place and respects reduced motion', async ({ page }) => {
  await page.goto('/')
  await show(page, room())
  await expect(page.locator('.felt')).toBeVisible()
  const defended = outcome({ type: 'CHECK_FAILED', challengerId: other.id })
  await show(page, room({ game: game({ outcomes: [defended] }) }))
  await expect(page.getByRole('heading', { name: 'Truth defended!' })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss result' }).click()
  const checked = outcome({ id: 2, type: 'CHECK_SUCCEEDED', playerId: other.id, challengerId: self.id })
  await show(page, room({ game: game({ outcomes: [defended, checked] }) }))
  await expect(page.getByRole('heading', { name: 'Truth Check won!' })).toBeVisible()
  await expect(page.locator('.verdict-card')).toHaveCount(1)
  await expect(page.locator('.verdict-card')).toHaveCSS('transform', 'none')
  await page.getByRole('button', { name: 'Dismiss result' }).click()
  await expect(page.locator('.verdict-card')).toHaveCount(0)
})
