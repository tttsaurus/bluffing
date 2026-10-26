import { expect, test, type Page } from '@playwright/test'
import { game, other, room, self } from '../tests/fixtures'
import type { GameView, RoomView, TableAction } from '../src/types'

async function show(page: Page, view: RoomView) {
  await page.evaluate(async ({ view, self }) => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: true })
  }, { view, self })
}
function skinnedRoom(view: GameView) {
  const snapshot = room({ game: view })
  snapshot.players[0].equippedSkin = 'AURORA'
  snapshot.players[1].equippedSkin = 'SUPERNOVA'
  return snapshot
}
const play = { id: 1, playerId: self.id, declaredRank: 'A', cardCount: 2, status: 'PENDING' as const, revealedCards: [] }
const first: TableAction = { id: 1, type: 'PLAY', playerId: self.id, playId: 1, cardCount: 2, declaredRank: 'A' }
const folded: TableAction = { id: 2, type: 'FOLD', playerId: other.id, cardCount: 0, declaredRank: 'A' }

test('expanded history covers Stop deal, fits the viewport, and counts folds after a pool reset', async ({ page }) => {
  await page.goto('/')
  await show(page, room({ game: game({ actions: [first, folded], plays: [{ ...play, status: 'PASSED' }] }) }))
  const summary = page.locator('.history-menu > summary')
  await expect(summary).toContainText('2')
  await summary.click()
  const history = page.getByRole('region', { name: 'Recent plays' })
  await expect(history.getByText('Folded', { exact: true })).toBeVisible()
  await expect(history.getByRole('listitem')).toHaveCount(2)
  const stop = await page.getByRole('button', { name: 'Stop deal' }).boundingBox()
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.play-history')), {
    x: stop!.x + stop!.width / 2, y: stop!.y + stop!.height / 2,
  })).toBe(true)
  const bounds = (await history.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const leave = page.getByRole('button', { name: /Leave/ })
  await expect(leave).toBeVisible()
  await expect(leave).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('history-over-stop.png'), fullPage: true })
  await summary.click()
  await page.getByRole('button', { name: 'Stop deal' }).click()
  await expect(page.getByRole('dialog', { name: 'Force stop this deal' })).toBeVisible()
})

test('local and remote plays throw cards, folds stay at seats, and checks reveal private faces', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  let view: GameView = game({ actions: [] })
  await show(page, skinnedRoom(view))
  await expect(page.locator('.table-seat')).toHaveCount(2)
  await expect(page.locator('.table-action-effect')).toHaveCount(0)
  await page.locator('.pool canvas').evaluate(canvas => canvas.setAttribute('data-kept', 'pool'))
  const tableAppearance = () => page.locator('.felt').evaluate(element => {
    const style = getComputedStyle(element)
    return { background: style.background, borderColor: style.borderColor, boxShadow: style.boxShadow }
  })
  const houseFelt = await tableAppearance()
  await expect(page.locator('.turn-aura, .shader-surface')).toHaveCount(0)
  view = { ...view, actions: [first], plays: [play], poolSize: 2, targetRank: 'A', currentPlayerId: other.id }
  await show(page, skinnedRoom(view))
  // A flying card uses a 2D copy of its owner's exact shader artwork. Its fixed
  // left/top remain unchanged while a compositor transform moves it to the pool.
  const flight = await page.locator('.thrown-card').first().evaluate(element => {
    const animation = element.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => frame.transform))!
    animation.pause()
    animation.currentTime = 100
    const initial = { left: element.getAttribute('style')!.match(/left: [^;]+/)?.[0], top: element.getAttribute('style')!.match(/top: [^;]+/)?.[0], transform: getComputedStyle(element).transform }
    animation.currentTime = 300
    const transform = getComputedStyle(element).transform
    const compositorFrames = (animation.effect as KeyframeEffect).getKeyframes().filter(frame => frame.transform).length
    animation.play()
    const canvas = element.querySelector('canvas')!
    const context = canvas.getContext('2d')!
    return { initial, left: (element as HTMLElement).style.left, top: (element as HTMLElement).style.top,
      transform, pixel: [...context.getImageData(60, 90, 1, 1).data], compositorFrames }
  })
  await expect(page.locator('.effect-play')).toHaveAttribute('data-player-id', self.id)
  await expect(page.locator('.thrown-card')).toHaveCount(2)
  await expect(page.locator('.thrown-card .skin-aurora')).toHaveCount(2)
  await expect(page.locator('.pool canvas')).toHaveAttribute('data-kept', 'pool')
  expect(await tableAppearance()).toEqual(houseFelt)
  expect(flight.initial.left).toBe(`left: ${flight.left}`)
  expect(flight.initial.top).toBe(`top: ${flight.top}`)
  expect(flight.transform).not.toBe(flight.initial.transform)
  expect(flight.pixel[3]).toBe(255)
  expect(flight.compositorFrames).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('self-throw.png') })
  await expect(page.locator('.effect-play')).toHaveCount(0)
  view = { ...view, actions: [first, folded], currentPlayerId: self.id, consecutiveFolds: 1 }
  await show(page, skinnedRoom(view))
  await expect(page.locator('.effect-fold')).toHaveAttribute('data-player-id', other.id)
  await expect(page.locator('.thrown-card')).toHaveCount(0)
  await expect(page.locator('.current-play-bar')).toContainText('folded')
  await expect(page.locator('.effect-fold')).toHaveCount(0)
  const remote = { ...first, id: 3, playId: 2, playerId: other.id }
  view = { ...view, actions: [first, folded, remote], plays: [play, { ...play, id: 2, playerId: other.id }], poolSize: 4 }
  await show(page, skinnedRoom(view))
  await expect(page.locator('.effect-play')).toHaveAttribute('data-player-id', other.id)
  await expect(page.locator('.thrown-card .skin-supernova')).toHaveCount(2)
  await expect(page.locator('.pool canvas')).toHaveAttribute('data-kept', 'pool')
  expect(await tableAppearance()).toEqual(houseFelt)
  await page.screenshot({ path: test.info().outputPath('remote-throw.png') })
  await expect(page.locator('.effect-play')).toHaveCount(0)
  const checked = { ...first, id: 4, type: 'CHALLENGE' as const, playId: 2 }
  view = { ...view, poolSize: 0, actions: [...view.actions!, checked], plays: [play, { ...play, id: 2, playerId: other.id, status: 'LIE', challengerId: self.id,
    revealedCards: [{ id: 'secret', rank: 'K', suit: 'HEARTS' }, { id: 'secret2', rank: '2', suit: 'CLUBS' }] }] }
  await show(page, skinnedRoom(view))
  await expect(page.locator('.thrown-hand')).toBeVisible()
  await expect(page.locator('.pool-check-reveal')).toBeVisible()
  await expect(page.locator('.pool-reveal-card')).toHaveText(['K♥', '2♣'])
  await expect(page.locator('.pool-check-reveal')).toContainText('BLUFF CAUGHT')
  await expect(page.locator('.pool-check-reveal')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: test.info().outputPath('truth-check-reveal.png') })
  await expect(page.locator('.effect-challenge')).toHaveCount(0)
  await page.reload()
  await show(page, room({ game: view }))
  await expect(page.locator('.table-action-effect')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('bursts queue each action and the final truth check finishes before setup returns', async ({ page }) => {
  await page.goto('/')
  await show(page, room({ game: game({ actions: [] }) }))
  await expect(page.locator('.table-seat')).toHaveCount(2)
  const checked: TableAction = { ...first, id: 3, type: 'CHALLENGE', playerId: other.id }
  await show(page, room({ game: game({ phase: 'FINISHED', winnerId: self.id, actions: [first, folded, checked],
    plays: [{ ...play, status: 'TRUTH', challengerId: other.id }] }) }))
  await expect(page.locator('.effect-play')).toBeVisible()
  await expect(page.locator('.effect-fold')).toBeVisible()
  await expect(page.locator('.effect-challenge')).toBeVisible()
  await expect(page.locator('.pool-check-reveal')).toContainText('Card faces revealed to the checker')
  await expect(page.locator('.pool-reveal-card')).toHaveText(['?', '?'])
  await expect(page.getByRole('region', { name: 'Players', exact: true })).toBeVisible()
})

test('Joker, SPELL and two-digit ranks fit inside revealed cards', async ({ page }) => {
  await page.goto('/')
  await show(page, room({ game: game({ actions: [] }) }))
  await expect(page.locator('.table-seat')).toHaveCount(2)
  await show(page, room({ game: game({
    actions: [{ id: 1, type: 'CHALLENGE', playerId: self.id, playId: 1, cardCount: 3, declaredRank: 'A' }],
    plays: [{ ...play, playerId: other.id, cardCount: 3, status: 'TRUTH', challengerId: self.id, revealedCards: [
      { id: 'joker', rank: 'JOKER', suit: 'JOKER' }, { id: 'spell', rank: 'SPELL', suit: 'SPADES' }, { id: 'ten', rank: '10', suit: 'HEARTS' },
    ] }],
  }) }))
  await expect(page.locator('.pool-reveal-card')).toHaveText(['JOKER✦', 'SPELL♠', '10♥'])
  for (const rank of await page.locator('.reveal-card-rank').all()) {
    expect(await rank.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const bounds = (await rank.boundingBox())!, card = (await rank.locator('..').boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(card.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(card.x + card.width)
  }
  await page.screenshot({ path: test.info().outputPath('special-card-reveal.png') })
})
