import { expect, test } from '@playwright/test'
import { game, room, self } from '../tests/fixtures'

test('browser transport recovery preserves its hand and session without an invalid close-code error', async ({ page }) => {
  const view = room({ game: game({ hand: Array.from({ length: 200 }, (_, index) => ({
    id: `card-${index}`, rank: 'A', suit: 'SPADES' as const,
  })) }) })
  const sessions: string[] = [], closeCodes: number[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === 'AUTH') {
        sessions.push(message.payload.sessionId)
        socket.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId: self.id, commandReceipts: 1 } }))
      }
      if (message.type === 'SYNC_ROOM') socket.send(JSON.stringify({ type: 'ROOM_STATE', revision: 1, payload: view }))
    })
    socket.onClose(code => { if (code !== undefined) closeCodes.push(code) })
  })
  await page.goto('/')
  await page.evaluate(async ({ view, self }) => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: view, player: self, bootstrapping: false, connected: false })
    useGameStore.getState().reconnect()
  }, { view, self })
  await expect(page.locator('.playing-card').first()).toBeEnabled()
  await page.evaluate(async () => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    const socket = useGameStore.getState().socket!
    socket.onerror?.call(socket, new Event('error'))
  })
  await expect.poll(() => sessions.length).toBe(2)
  expect(sessions[1]).toBe(sessions[0])
  expect(closeCodes).toContain(4000)
  await expect(page.locator('.playing-card')).toHaveCount(200)
  await expect(page.locator('.playing-card').first()).toBeEnabled()
  expect(errors).toEqual([])
})
