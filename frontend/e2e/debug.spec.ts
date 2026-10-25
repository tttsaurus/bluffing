import { expect, test } from '@playwright/test'
import type { RoomView } from '../src/types'

test('two tabs use root and a persistent debug bot, including spelling with Web Audio denied', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('PLAYER NAME', { exact: true }).fill('Debug owner')
  await page.getByRole('button', { name: 'Take a seat' }).click()
  await expect(page.getByRole('button', { name: 'Switch to debug bot' })).toBeVisible()
  const root = await page.evaluate(() => ({ token: localStorage.getItem('bluff-table-device-token')!, player: JSON.parse(localStorage.getItem('bluff-table-player')!) }))
  const botPage = await context.newPage()
  botPage.on('pageerror', error => errors.push(error.message))
  await botPage.addInitScript(() => { window.AudioContext = class { constructor() { throw new Error('Web Audio denied') } } as unknown as typeof AudioContext })
  let roomId: string | undefined
  try {
    await botPage.goto('/')
    await botPage.getByRole('button', { name: 'Switch to debug bot' }).click()
    await expect(botPage.getByRole('button', { name: 'Switch to root' })).toBeVisible()
    const bot = await botPage.evaluate(() => JSON.parse(sessionStorage.getItem('bluff-table-debug-identity')!))
    expect(bot.player.id).not.toBe(root.player.id)
    expect(bot.player.root).toBe(false)
    const forbidden = await page.request.post('/api/players/me/debug-identity', { headers: { Authorization: `Bearer ${bot.token}` } })
    expect(forbidden.status()).toBe(403)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Switch to debug bot' })).toBeVisible()
    await botPage.reload()
    await expect(botPage.getByRole('button', { name: 'Switch to root' })).toBeVisible()
    const name = `Debug spell ${Date.now()}`
    await page.getByLabel('ROOM TYPE', { exact: true }).selectOption('LIARS_DECK_4_FUN')
    await page.getByLabel('ROOM NAME', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Create table' }).click()
    await expect(page.getByRole('region', { name: 'Players' })).toBeVisible()
    const rooms = await page.request.get('/api/rooms', { headers: { Authorization: `Bearer ${root.token}` } })
    roomId = (await rooms.json()).find((room: {name: string}) => room.name === name).id
    await botPage.getByRole('article').filter({ has: botPage.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: 'Join table' }).click()
    await expect(page.getByText('HERE', { exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Deal the cards' }).click()
    const snapshot = async (): Promise<RoomView> => (await page.request.get(`/api/rooms/${roomId}/snapshot`, { headers: { Authorization: `Bearer ${root.token}` } })).json()
    await expect.poll(async () => (await snapshot()).game?.phase).toBe('ACTIVE')
    const actor = (await snapshot()).game!.currentPlayerId === root.player.id ? page : botPage
    const checker = actor === page ? botPage : page
    await actor.getByRole('button', { name: 'Spell card', exact: true }).click()
    await actor.getByRole('button', { name: /^PLAY / }).click()
    await checker.getByRole('button', { name: /^TRUTH CHECK/ }).click()
    for (const tab of [page, botPage]) {
      await expect(tab.getByRole('dialog', { name: 'Spelling challenge' })).toBeVisible()
      await expect(tab.getByRole('heading', { name: 'Spell the word.' })).toBeVisible()
      const spellingInput = await tab.getByLabel('YOUR SPELLING', { exact: true }).boundingBox()
      expect(spellingInput!.width).toBeGreaterThan(200)
      await tab.screenshot({ path: test.info().outputPath(tab === page ? 'root-spelling.png' : 'bot-spelling-fallback.png') })
      await tab.getByLabel('YOUR SPELLING', { exact: true }).fill('debugwrong')
      await tab.getByRole('button', { name: 'Submit', exact: true }).click()
    }
    await expect(botPage.getByRole('heading', { name: 'The verdict is in.' })).toBeVisible()
    expect(errors).toEqual([])
    // Retiring the bot's tab must not retire the root's authenticated socket.
    await botPage.getByRole('button', { name: 'Back to the table' }).click()
    await botPage.getByRole('button', { name: /Leave/ }).click()
    await botPage.getByRole('button', { name: 'Leave deal →', exact: true }).click()
    await expect(botPage.getByRole('button', { name: 'Switch to root' })).toBeVisible()
    await botPage.getByRole('button', { name: 'Switch to root' }).click()
    await expect(botPage.getByRole('button', { name: 'Switch to debug bot' })).toBeVisible()
    await botPage.getByRole('button', { name: 'Switch to debug bot' }).click()
    await expect.poll(() => botPage.evaluate(() => JSON.parse(sessionStorage.getItem('bluff-table-debug-identity') ?? 'null')?.player.id)).toBe(bot.player.id)
    expect(await page.evaluate(() => localStorage.getItem('bluff-table-device-token'))).toBe(root.token)
  } finally {
    await botPage.close()
    if (roomId) await page.request.delete(`/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${root.token}` } })
  }
})
