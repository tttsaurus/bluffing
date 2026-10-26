import { expect, test } from '@playwright/test'
import { game, room, self } from '../tests/fixtures'

test('waiting notices collapse smoothly, stay consumed after re-entry and reset for a later deal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const view = room({ status: 'LOBBY', game: null, notice: 'Deal stopped. Room wallets restored.' })
  await page.goto('/')
  await page.evaluate(async ({ view, self }) => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true })
  }, { view, self })
  await expect(page.getByText('■ Table reset')).toBeVisible()
  // Observe real animation frames: setup must move through intermediate positions
  // while the banner collapses, rather than jumping when the fade finishes.
  const frames = await page.evaluate(async () => {
    const slot = document.querySelector('.match-result-slot')!
    const setup = document.querySelector('.waiting-layout')!
    return new Promise<{ height: number; top: number }[]>(resolve => {
      const frames: { height: number; top: number }[] = []
      let stableHeight = 0, shrinking = false
      const started = performance.now()
      const sample = () => {
        const height = slot.getBoundingClientRect().height
        stableHeight = Math.max(stableHeight, height)
        if (stableHeight > 20 && height < stableHeight - 1) shrinking = true
        if (shrinking) frames.push({ height, top: setup.getBoundingClientRect().top })
        if ((shrinking && height < .5) || performance.now() - started > 9000) resolve(frames)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
  expect(frames.length).toBeGreaterThan(3)
  expect(new Set(frames.map(frame => Math.round(frame.top))).size).toBeGreaterThan(3)
  await expect(page.locator('.match-result-slot')).toHaveCount(0)
  await page.evaluate(async view => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: { ...view, id: 'other-room', notice: null } })
  }, view)
  await page.evaluate(async view => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view })
  }, view)
  await expect(page.getByText('■ Table reset')).toHaveCount(0)
  await page.evaluate(async view => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: { ...view, notice: null, status: 'IN_GAME', game: view.game } })
  }, { ...view, game: game({ gameId: 'another-deal' }) })
  await expect(page.locator('.battle-page')).toBeVisible()
  await page.evaluate(async view => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view })
  }, view)
  await expect(page.getByText('■ Table reset')).toBeVisible()
})
