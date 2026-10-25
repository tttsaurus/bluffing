import { test, expect } from '@playwright/test'

test('built all-in-one server preserves local root and tab-specific debug identity on a non-default port', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The integration backend serves frontend/dist itself, with no Vite proxy.
  await page.goto('http://127.0.0.1:8181/')
  await page
    .getByLabel('PLAYER NAME', { exact: true })
    .fill('Built local runner')
  await page.getByRole('button', { name: 'Take a seat' }).click()
  await expect(
    page.getByRole('button', { name: 'Switch to debug bot' })
  ).toBeVisible()
  const rootId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('bluff-table-player')!).id
  )
  const other = await context.newPage()
  try {
    other.on('pageerror', (error) => errors.push(error.message))
    await other.goto('http://127.0.0.1:8181/')
    await other.getByRole('button', { name: 'Switch to debug bot' }).click()
    await expect(
      other.getByRole('button', { name: 'Switch to root' })
    ).toBeVisible()
    const bot = await other.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('bluff-table-debug-identity')!).player
    )
    expect(bot.id).not.toBe(rootId)
    expect(bot.root).toBe(false)
    await page.reload()
    await other.reload()
    await expect(
      page.getByRole('button', { name: 'Switch to debug bot' })
    ).toBeVisible()
    await expect(
      other.getByRole('button', { name: 'Switch to root' })
    ).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await other.close()
  }
})
