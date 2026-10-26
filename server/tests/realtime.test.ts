import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { Realtime } from '../src/realtime.ts'
import type { Identities, Account } from '../src/identity.ts'
import type { Rooms } from '../src/rooms.ts'
import type { RoomView } from '../../shared/contracts.ts'
import { applyRoomOperations } from '../../shared/roomUpdates.ts'
import { engine } from '../src/game/engine.ts'

async function fixture(t: TestContext, updates = true) {
  const rules = engine('LIARS_DECK_4FUN_PLUS'), ids = [randomUUID(), randomUUID()]
  const state = rules.start(randomUUID(), ids, { deckCount: 8, cardsPerPlayer: 200 })
  const actor = state.order[state.currentIndex]
  const account: Account = { id: actor, display_name: 'Live tester', device_token_hash: '', root_account: false, debug_owner_id: null }
  let name = 'Large table'
  const rooms = {
    async authenticateSession() {}, async heartbeat() {}, async enter() {}, async disconnect() {}, async leave() {},
    async aggregate() { return {} },
    project(): RoomView { return { id: state.roomId, name, hostId: actor, gameType: state.type, status: 'IN_GAME',
      players: [], skins: [], records: [], notice: null, game: rules.view(state, actor) } },
    async command(_actor: Account, command: Parameters<Rooms['command']>[1]) { rules.command(state, actor, command) },
  }
  const server = createServer(), realtime = new Realtime(server,
    { async authenticate() { return account } } as unknown as Identities, rooms as unknown as Rooms)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`)
  const events: { type: string; payload: any; revision?: number }[] = []
  ws.on('message', data => events.push(JSON.parse(data.toString())))
  t.after(async () => {
    ws.close(1012)
    await realtime.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  async function wait(predicate: (event: typeof events[number]) => boolean) {
    const started = Date.now()
    while (!events.some(predicate)) {
      if (Date.now() - started > 5000) throw new Error('Timed out waiting for live event')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    return events.findLast(predicate)!
  }
  await new Promise<void>(resolve => ws.once('open', resolve))
  ws.send(JSON.stringify({ type: 'AUTH', payload: { deviceToken: 't'.repeat(40), sessionId: randomUUID(), ...(updates ? { roomUpdates: 1 } : {}) } }))
  await wait(event => event.type === 'CONNECTED')
  ws.send(JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId: state.roomId } }))
  const initial = await wait(event => event.type === 'ROOM_STATE')
  return { ws, realtime, initial, events, rooms, state, actor, wait, rename: (value: string) => { name = value } }
}

test('a live 200-card play uses a compact update and a resync returns a complete private view', async t => {
  const f = await fixture(t)
  const cardIds = f.state.hands[f.actor].slice(0, 200).map(card => card.id)
  f.ws.send(JSON.stringify({ type: 'GAME_COMMAND', payload: { roomId: f.state.roomId, gameId: f.state.gameId,
    requestId: randomUUID(), action: 'PLAY', cardIds, declaredRank: 'A' } }))
  const event = await f.wait(event => event.type === 'ROOM_UPDATE')
  assert.equal(event.payload.baseRevision, f.initial.revision)
  const updated = applyRoomOperations(f.initial.payload, event.payload.operations)
  assert.equal(updated.game!.hand.length, 1)
  assert.equal(updated.game!.poolSize, 200)
  assert.equal(updated.game!.plays!.at(-1)!.cardCount, 200)
  assert.ok(Buffer.byteLength(JSON.stringify(event)) < 3000)
  f.ws.send(JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId: f.state.roomId } }))
  const complete = await f.wait(event => event.type === 'ROOM_STATE' && event.revision! > f.initial.revision!)
  assert.deepEqual(complete.payload, updated)
  assert.equal(f.ws.readyState, WebSocket.OPEN)
})

test('temporary send backpressure coalesces to the latest state without disconnecting', async t => {
  const f = await fixture(t)
  const peer = [...f.realtime.sockets.clients][0]
  let buffered = 600 * 1024
  Object.defineProperty(peer, 'bufferedAmount', { configurable: true, get: () => buffered })
  f.rename('Intermediate')
  await f.realtime.refresh(f.state.roomId)
  assert.equal(peer.readyState, WebSocket.OPEN)
  assert.equal(f.events.filter(event => event.type === 'ROOM_UPDATE').length, 0)
  f.rename('Latest')
  await f.realtime.refresh(f.state.roomId)
  buffered = 0
  await f.realtime.refresh(f.state.roomId, false)
  const update = await f.wait(event => event.type === 'ROOM_UPDATE')
  assert.equal(applyRoomOperations(f.initial.payload, update.payload.operations).name, 'Latest')
  assert.equal(update.payload.baseRevision, f.initial.revision)
  assert.equal(peer.readyState, WebSocket.OPEN)
})

test('old clients continue receiving full room snapshots', async t => {
  const f = await fixture(t, false)
  f.rename('Compatible')
  await f.realtime.refresh(f.state.roomId)
  await f.wait(event => event.type === 'ROOM_STATE' && event.payload.name === 'Compatible')
  assert.equal(f.events.some(event => event.type === 'ROOM_UPDATE'), false)
})

test('browser recovery code 4000 preserves the room lease', async t => {
  const f = await fixture(t)
  const disconnected = t.mock.method(f.rooms, 'disconnect')
  await new Promise<void>(resolve => {
    f.ws.once('close', () => resolve())
    f.ws.close(4000, 'Reconnecting')
  })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(disconnected.mock.callCount(), 0)
})

test('Vercel sockets have no forced rotation and a stalled server does not mistake delayed pongs for dead peers', async t => {
  const previous = process.env.VERCEL
  process.env.VERCEL = '1'
  t.after(() => { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous })
  const originalTimeout = globalThis.setTimeout, originalInterval = globalThis.setInterval
  const timeouts: number[] = []
  let heartbeat = () => {}
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    timeouts.push(delay ?? 0)
    return originalTimeout(callback, delay, ...args)
  }) as typeof setTimeout)
  t.mock.method(globalThis, 'setInterval', ((callback: () => void, delay?: number) => {
    if (delay === 10_000) heartbeat = callback
    return originalInterval(callback, delay)
  }) as typeof setInterval)
  const f = await fixture(t)
  assert.equal(timeouts.includes(240_000), false)
  const peer = [...f.realtime.sockets.clients][0]
  let flush: () => void = () => {}
  t.mock.method(peer, 'ping', (flushed: any) => { flush = flushed })
  const now = Date.now()
  const clock = t.mock.method(Date, 'now', () => now + 60_000)
  heartbeat()
  assert.equal(peer.readyState, WebSocket.OPEN)
  for (const offset of [70_000, 80_000, 90_000, 100_001]) {
    clock.mock.mockImplementation(() => now + offset)
    heartbeat()
  }
  assert.equal(peer.readyState, WebSocket.OPEN, 'a ping queued behind a snapshot has no pong deadline yet')
  flush()
  for (const offset of [110_000, 120_000, 130_000, 140_001]) {
    clock.mock.mockImplementation(() => now + offset)
    heartbeat()
  }
  assert.equal(peer.readyState, WebSocket.CLOSING, 'a genuinely unresponsive peer still gets terminated')
})
