import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { game, other, room, self } from '../tests/fixtures'
import { roomOperations } from '../../shared/roomUpdates'

test('selecting and playing 200 cards uses one command and a compact live update', async ({ page }) => {
  const initial = room({ gameType: 'LIARS_DECK_4_FUN', game: game({
    hand: Array.from({ length: 200 }, () => ({ id: randomUUID(), rank: 'A', suit: 'SPADES' as const })),
    hands: [{ playerId: self.id, cardCount: 200 }, { playerId: other.id, cardCount: 5 }],
  }) })
  const after = structuredClone(initial)
  Object.assign(after.game!, { hand: [], currentPlayerId: other.id, targetRank: 'A', poolSize: 200,
    hands: [{ playerId: self.id, cardCount: 0 }, { playerId: other.id, cardCount: 5 }],
    actions: [{ id: 1, type: 'PLAY', playerId: self.id, playId: 1, cardCount: 200, declaredRank: 'A' }],
    plays: [{ id: 1, playerId: self.id, cardCount: 200, declaredRank: 'A', status: 'PENDING', revealedCards: [] }],
  })
  const commands: { type: string; payload: { requestId: string; cardIds: string[] } }[] = []
  const update = { type: 'ROOM_UPDATE', payload: { roomId: initial.id, baseRevision: 1, revision: 2, operations: roomOperations(initial, after) } }
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(data => {
      const message = JSON.parse(String(data))
      if (message.type === 'AUTH') socket.send(JSON.stringify({ type: 'CONNECTED', payload: { playerId: self.id, commandReceipts: 1 } }))
      if (message.type === 'SYNC_ROOM') socket.send(JSON.stringify({ type: 'ROOM_STATE', revision: 1, payload: initial }))
      if (message.type === 'GAME_COMMAND') {
        commands.push(message)
        socket.send(JSON.stringify(update))
        socket.send(JSON.stringify({ type: 'COMMAND_CONFIRMED', payload: { requestId: message.payload.requestId } }))
      }
    })
  })
  await page.goto('/')
  await page.evaluate(async ({ initial, self }) => {
    const path = '/src/store.ts'
    const { useGameStore } = await import(path)
    useGameStore.setState({ room: initial, player: self, bootstrapping: false, connected: false })
    useGameStore.getState().reconnect()
  }, { initial, self })
  await expect(page.locator('.playing-card')).toHaveCount(200)
  await expect(page.locator('.playing-card').first()).toBeEnabled()
  const first = (await page.locator('.playing-card').first().boundingBox())!
  const hand = page.getByLabel('Your hand', { exact: true })
  await page.mouse.move(first.x + 12, first.y + 40)
  await page.mouse.down()
  await hand.evaluate(element => { element.scrollLeft = element.scrollWidth })
  const bounds = (await hand.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width - 4, first.y + 40)
  await page.mouse.up()
  await expect(page.locator('.playing-card[aria-pressed="true"]')).toHaveCount(200)
  await page.getByRole('button', { name: 'PLAY 200', exact: true }).click()
  await expect(page.locator('.playing-card')).toHaveCount(0)
  await expect(page.locator('.pool-current-rank')).toContainText('A')
  expect(commands).toHaveLength(1)
  expect(commands[0].payload.cardIds).toEqual(initial.game!.hand.map(card => card.id))
  expect(Buffer.byteLength(JSON.stringify(commands[0]))).toBeLessThan(9000)
  expect(Buffer.byteLength(JSON.stringify(update))).toBeLessThan(2000)
  await expect(page.getByRole('button', { name: 'RECONNECT ↻', exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('200-card-play.png') })
})
