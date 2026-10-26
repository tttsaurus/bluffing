import { expect, test, type Page } from '@playwright/test'

// Exercise actual browser recoloring, not just prefers-color-scheme CSS.
test.use({
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
  launchOptions: { args: ['--enable-features=WebContentsForceDark', '--force-dark-mode'] },
})

async function roomCardPixel(page: Page) {
  const card = page.locator('.room-card').first()
  await card.scrollIntoViewIfNeeded()
  const bounds = await card.boundingBox()
  expect(bounds).not.toBeNull()
  const png = await page.screenshot({ scale: 'css' })
  // Forced-dark rendering changes painted pixels without changing computed CSS.
  return page.evaluate(async ({ png, x, y }) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
    const image = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    image.close()
    return Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3)
  }, { png: png.toString('base64'), x: Math.floor(bounds!.x + 8), y: Math.floor(bounds!.y + 8) })
}

test('first login and reload keep cream room cards even with browser auto-dark enabled', async ({ page }) => {
  const player = { id: 'theme-player', displayName: 'Theme player', identityTag: 'abcde', root: false }
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({
      json: path.startsWith('/api/players') ? player : [{
        id: 'theme-room', name: 'Palette table', gameType: 'LIARS_DECK', status: 'LOBBY',
        hostId: player.id, playerCount: 2, maxPlayers: 8, activePlayerCount: 0,
        createdAt: '2026-10-25T00:00:00Z', joined: true,
      }],
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  })
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type === 'AUTH')
        socket.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId: player.id } }))
    })
  })
  const navigation = await page.goto('/')
  const initialHtml = await navigation!.text()
  expect(initialHtml).toContain('name="color-scheme" content="only light"')
  expect(initialHtml).toContain('name="darkreader-lock"')
  expect(initialHtml.indexOf('name="darkreader-lock"')).toBeLessThan(initialHtml.indexOf('src="/src/main.tsx"'))
  // These declarations must exist in the initial document, not appear after login.
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'only light')
  await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(1)
  await expect(page.locator('html')).toHaveCSS('color-scheme', /only light|light only/)
  await page.getByLabel('PLAYER NAME', { exact: true }).fill(player.displayName)
  await page.getByRole('button', { name: 'Take a seat' }).click()
  await expect(page.getByRole('heading', { name: 'Palette table' })).toBeVisible()
  await expect(page.locator('.lobby')).toHaveCSS('opacity', '1')
  const firstLogin = await roomCardPixel(page)
  expect(firstLogin.every(channel => channel > 200), `First-login card pixel: ${firstLogin}`).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Palette table' })).toBeVisible()
  await expect(page.locator('.lobby')).toHaveCSS('opacity', '1')
  const afterReload = await roomCardPixel(page)
  expect(afterReload.every(channel => channel > 200), `Reload card pixel: ${afterReload}`).toBe(true)
  for (let channel = 0; channel < 3; channel++)
    expect(Math.abs(firstLogin[channel] - afterReload[channel])).toBeLessThanOrEqual(3)
})
