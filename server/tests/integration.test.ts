import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import pg from 'pg'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createPool } from '../src/db.ts'
import { Identities, tokenHash, type Account } from '../src/identity.ts'
import { Rooms } from '../src/rooms.ts'
import { createApplication } from '../src/http.ts'
import { AppError } from '../src/errors.ts'
import { migrate, migrationFiles } from '../../scripts/db/migrate.ts'
import type { GameState } from '../src/game/state.ts'
import type { GameType } from '../../shared/contracts.ts'

const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  !/^blufftable_[a-zA-Z0-9_]*qa$/.test(new URL(url).pathname.slice(1))
)
  throw new Error(
    'TEST_DATABASE_URL must explicitly target a disposable blufftable_*qa database'
  )
const first = createPool(url),
  second = createPool(url),
  identities = new Identities(first),
  roomsA = new Rooms(first),
  roomsB = new Rooms(second)
const accounts = new Set<string>(),
  roomIds = new Set<string>()
before(async () => {
  await migrate(url)
})
after(async () => {
  for (const id of roomIds)
    await first.query('DELETE FROM rooms WHERE id=$1', [id])
  if (accounts.size) {
    await first.query(
      'DELETE FROM players WHERE id=ANY($1::uuid[]) AND debug_owner_id IS NOT NULL',
      [[...accounts]]
    )
    await first.query('DELETE FROM players WHERE id=ANY($1::uuid[])', [
      [...accounts],
    ])
  }
  await first.end()
  await second.end()
})
async function account(root = false) {
  const token = randomBytes(32).toString('hex'),
    view = await identities.restore('QA player', token, root)
  accounts.add(view.id)
  return { token, actor: await identities.authenticate(token) }
}
async function setup(type: GameType = 'LIARS_DECK', count = 2, online = count) {
  const players = await Promise.all(
    Array.from({ length: count }, (_, i) => account(i === 0))
  )
  const room = await roomsA.create(
    players[0].actor,
    `QA ${randomUUID().slice(0, 8)}`,
    type
  )
  roomIds.add(room.id)
  for (const player of players.slice(1))
    await roomsA.join(room.id, player.actor)
  const sessions = [] as { id: string; connection: string; actor: Account }[]
  for (const player of players.slice(0, online)) {
    const session = {
      id: randomUUID(),
      connection: randomUUID(),
      actor: player.actor,
    }
    sessions.push(session)
    await roomsA.authenticateSession(
      session.id,
      session.connection,
      player.actor
    )
    await roomsA.enter(session.id, session.connection, room.id, player.actor)
  }
  return { id: room.id, players, sessions, host: players[0].actor }
}
async function start(type: GameType = 'LIARS_DECK', count = 2, online = count) {
  const f = await setup(type, count, online)
  await roomsA.start(f.id, f.host, { deckCount: 1, cardsPerPlayer: 3 })
  return f
}
async function state(id: string): Promise<GameState> {
  return (await first.query('SELECT game_state FROM rooms WHERE id=$1', [id]))
    .rows[0].game_state
}
async function play(id: string, players: { actor: Account }[]) {
  const s = await state(id),
    actor = players.find((p) => p.actor.id === s.order[s.currentIndex])!.actor
  await roomsA.command(actor, {
    roomId: id,
    action: 'PLAY',
    cardIds: [s.hands[actor.id][0].id],
    declaredRank: s.targetRank ? undefined : 'A',
    requestId: randomUUID(),
  })
  return actor
}

async function liveClient(app: ReturnType<typeof createApplication>, token: string, roomId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`)
  const events: { type: string; payload: any }[] = []
  ws.on('message', data => events.push(JSON.parse(data.toString())))
  async function wait(predicate: (event: typeof events[number]) => boolean) {
    const previous = events.find(predicate)
    if (previous) return previous
    return new Promise<typeof events[number]>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for live event')) }, 5000)
      const listener = (data: import('ws').RawData) => {
        const event = JSON.parse(data.toString())
        if (predicate(event)) { cleanup(); resolve(event) }
      }
      function cleanup() { clearTimeout(timeout); ws.off('message', listener) }
      ws.on('message', listener)
    })
  }
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.send(JSON.stringify({ type: 'AUTH', payload: { deviceToken: token, sessionId: randomUUID() } }))
  await wait(event => event.type === 'CONNECTED')
  ws.send(JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId } }))
  await wait(event => event.type === 'ROOM_STATE')
  return { ws, events, wait }
}

test('live sockets batch lease writes, tolerate temporary database errors and still reject expired sessions', async t => {
  const f = await start()
  const previousVercel = process.env.VERCEL
  delete process.env.VERCEL
  const timeouts: number[] = []
  const originalTimeout = globalThis.setTimeout, originalInterval = globalThis.setInterval
  let heartbeat: (() => void) | undefined
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    timeouts.push(delay ?? 0)
    return originalTimeout(callback, delay, ...args)
  }) as typeof setTimeout)
  t.mock.method(globalThis, 'setInterval', ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 10_000) heartbeat = callback
    return originalInterval(callback, delay, ...args)
  }) as typeof setInterval)
  const app = createApplication(first)
  let client: Awaited<ReturnType<typeof liveClient>> | undefined
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    const renewal = t.mock.method(app.rooms, 'heartbeat')
    client = await liveClient(app, f.players[0].token, f.id)
    assert.equal(timeouts.includes(240_000), false, 'self-hosted sockets must not rotate on a four-minute timer')
    await first.query('UPDATE room_memberships SET balance=2500 WHERE room_id=$1', [f.id])
    const game = await state(f.id)
    const requests = Array.from({ length: 10 }, () => randomUUID())
    for (const requestId of requests) client.ws.send(JSON.stringify({ type: 'GAME_COMMAND', payload: {
      roomId: f.id, gameId: game.gameId, action: 'THROW', item: 'TOMATO', targetId: f.players[1].actor.id, requestId,
    } }))
    await client.wait(event => event.type === 'THROW_CONFIRMED' && event.payload.requestId === requests.at(-1))
    assert.equal(client.events.filter(event => event.type === 'THROW_CONFIRMED').length, 10)
    assert.equal(renewal.mock.callCount(), 0, 'rapid commands share the fresh presence lease')
    assert.equal((await roomsA.view(f.id, f.host)).players.find(player => player.id === f.host.id)!.balance, 1500)
    const now = Date.now()
    const clock = t.mock.method(Date, 'now', () => now + 11_000)
    renewal.mock.mockImplementation(async () => { throw new Error('Temporary database outage') })
    const errors = t.mock.method(console, 'error', () => {})
    heartbeat!()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(errors.mock.callCount(), 1)
    assert.equal(client.ws.readyState, WebSocket.OPEN)
    renewal.mock.restore()
    const recovered = randomUUID()
    client.ws.send(JSON.stringify({ type: 'GAME_COMMAND', payload: {
      roomId: f.id, gameId: game.gameId, action: 'THROW', item: 'TOMATO', targetId: f.players[1].actor.id, requestId: recovered,
    } }))
    await client.wait(event => event.type === 'THROW_CONFIRMED' && event.payload.requestId === recovered)
    clock.mock.mockImplementation(() => now + 22_000)
    t.mock.method(app.rooms, 'heartbeat', async () => { throw new AppError(401, 'Session expired') })
    const closed = new Promise<number>(resolve => client!.ws.once('close', resolve))
    heartbeat!()
    assert.equal(await closed, 1008)
    clock.mock.restore()
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = previousVercel
    client?.ws.close()
    await app.realtime.close()
    await new Promise<void>(resolve => app.server.close(() => resolve()))
  }
})

test('a committed change during an in-flight refresh publishes immediately without waiting for the poll', async t => {
  const f = await setup(), app = createApplication(first)
  let client: Awaited<ReturnType<typeof liveClient>> | undefined
  let release = () => {}
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    client = await liveClient(app, f.players[0].token, f.id)
    let read = () => {}
    const firstRead = new Promise<void>(resolve => { read = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const aggregate = app.rooms.aggregate.bind(app.rooms)
    let calls = 0
    t.mock.method(app.rooms, 'aggregate', async (...args: Parameters<Rooms['aggregate']>) => {
      const snapshot = await aggregate(...args)
      if (++calls === 1) { read(); await gate }
      return snapshot
    })
    const polling = app.realtime.refresh(f.id, false)
    await firstRead
    const name = `Fresh ${randomUUID().slice(0, 8)}`
    await first.query('UPDATE rooms SET name=$2,version=version+1 WHERE id=$1', [f.id, name])
    const committed = app.realtime.refresh(f.id)
    release()
    await Promise.all([polling, committed])
    assert.equal(calls, 2)
    await client.wait(event => event.type === 'ROOM_STATE' && event.payload.name === name)
  } finally {
    release()
    client?.ws.close()
    await app.realtime.close()
    await new Promise<void>(resolve => app.server.close(() => resolve()))
  }
})

test('independent instances restore identity, preserve nickname conflicts, and provision one non-root debug bot under contention', async () => {
  const root = await account(true),
    restored = await new Identities(second).restore(
      'Stale nickname',
      root.token
    )
  assert.equal(restored.id, root.actor.id)
  assert.equal(restored.displayName, root.actor.display_name)
  const bots = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? identities : new Identities(second)).debug(root.actor)
    )
  )
  const bot = bots[0]
  accounts.add(bot.player.id)
  assert.equal(new Set(bots.map((b) => b.player.id)).size, 1)
  assert.equal(bot.player.root, false)
  const botAccount = await identities.authenticate(bot.deviceToken)
  await assert.rejects(() => identities.debug(botAccount), /Only root/)
  assert.equal(
    (await identities.restore('Promote?', bot.deviceToken, true)).root,
    false
  )
  const other = await account()
  await assert.rejects(() => identities.debug(other.actor), /Only root/)
})
test('fresh and Flyway V9 databases migrate without dropping wallets, ownership, identities or debug credentials', async () => {
  const name = `blufftable_legacy_${randomBytes(5).toString('hex')}qa`,
    legacy = new URL(url!)
  legacy.pathname = `/${name}`
  await first.query(`CREATE DATABASE "${name}"`)
  const client = new pg.Client({ connectionString: legacy.href })
  await client.connect()
  let legacyPool: pg.Pool | undefined
  try {
    const files = (await migrationFiles()).filter((file) => file.version <= 9)
    for (const file of files) await client.query(file.sql)
    await client.query(
      'CREATE TABLE flyway_schema_history(installed_rank INTEGER PRIMARY KEY,version VARCHAR(50),script VARCHAR(1000),success BOOLEAN NOT NULL)'
    )
    for (const file of files)
      await client.query(
        'INSERT INTO flyway_schema_history VALUES($1,$2,$3,true)',
        [file.version, String(file.version), file.name]
      )
    const owner = randomUUID(),
      botId = randomUUID(),
      room = randomUUID(),
      membership = randomUUID(),
      token = randomBytes(32).toString('hex'),
      hash = tokenHash(token),
      debugToken = tokenHash(`debug-identity-v1:${hash}`)
    await client.query(
      "INSERT INTO players(id,display_name,created_at,device_token_hash,root_account) VALUES($1,'Legacy owner',now(),$2,true)",
      [owner, hash]
    )
    await client.query(
      "INSERT INTO players(id,display_name,created_at,device_token_hash,debug_owner_id) VALUES($1,'Legacy bot',now(),$2,$3)",
      [botId, tokenHash(debugToken), owner]
    )
    await client.query(
      "INSERT INTO rooms(id,name,game_type,status,host_id,created_at) VALUES($1,'Legacy','LIARS_DECK','IN_GAME',$2,now())",
      [room, owner]
    )
    await client.query(
      "INSERT INTO room_memberships(id,room_id,player_id,seat_index,balance,game_start_balance,joined_at,wins,best_streak,equipped_skin,equipped_avatar) VALUES($1,$2,$3,0,1250,1000,now(),7,3,'AURORA','PORTRAIT')",
      [membership, room, owner]
    )
    await client.query("INSERT INTO member_skins VALUES($1,'AURORA')", [
      membership,
    ])
    await client.query("INSERT INTO member_avatars VALUES($1,'PORTRAIT')", [
      membership,
    ])
    await Promise.all([migrate(legacy.href), migrate(legacy.href)])
    const m = (
      await client.query('SELECT * FROM room_memberships WHERE id=$1', [
        membership,
      ])
    ).rows[0]
    assert.equal(Number(m.balance), 1000)
    assert.equal(Number(m.wins), 7)
    assert.equal(m.equipped_skin, 'AURORA')
    assert.equal(m.equipped_avatar, 'PORTRAIT')
    assert.equal(
      (await client.query('SELECT * FROM rooms WHERE id=$1', [room])).rows[0]
        .status,
      'LOBBY'
    )
    assert.equal(
      (await client.query('SELECT count(*) FROM member_skins')).rows[0].count,
      '1'
    )
    assert.equal(
      (await client.query('SELECT count(*) FROM member_avatars')).rows[0].count,
      '1'
    )
    legacyPool = createPool(legacy.href)
    const legacyIdentity = new Identities(legacyPool)
    const bot = await legacyIdentity.debug(
      await legacyIdentity.authenticate(token)
    )
    assert.equal(bot.player.id, botId)
    assert.equal(bot.deviceToken, debugToken)
    await client.query(
      "UPDATE bluff_migrations SET checksum='changed' WHERE version=1"
    )
    await assert.rejects(() => migrate(legacy.href), /checksum mismatch/)
  } finally {
    await legacyPool?.end()
    await client.end()
    await first.query(`DROP DATABASE "${name}"`)
  }
})
test('two present players can start while offline room members sit out', async () => {
  const f = await start('LIARS_DECK_PLUS', 4, 2),
    view = await roomsB.view(f.id, f.host)
  assert.equal(view.players.length, 4)
  assert.equal(view.game!.participants.length, 2)
  assert.equal(view.players.filter((p) => p.presence === 'ACTIVE').length, 2)
  assert.equal(view.players.filter((p) => p.presence === 'OFFLINE').length, 2)
  await assert.rejects(
    () => roomsA.view(f.id, f.players[3].actor),
    /not in this deal/
  )
})
test('same move arriving on two instances is committed once and only once', async () => {
  const f = await start(),
    s = await state(f.id),
    actor = f.players.find((p) => p.actor.id === s.order[s.currentIndex])!.actor
  const command = {
    roomId: f.id,
    action: 'PLAY' as const,
    cardIds: [s.hands[actor.id][0].id],
    declaredRank: 'A',
    requestId: randomUUID(),
  }
  await Promise.all([
    roomsA.command(actor, command),
    roomsB.command(actor, command),
  ])
  assert.equal((await state(f.id)).pool.length, 1)
  assert.equal((await state(f.id)).hands[actor.id].length, 2)
  await play(f.id, f.players)
  const view = await roomsB.view(f.id, f.host)
  assert.equal(view.players.find((p) => p.id === actor.id)!.balance, 10)
  assert.equal(
    view.game!.earnings.find((p) => p.playerId === actor.id)!.amount,
    10
  )
})
test('failed command rolls back both game state and idempotency receipt', async () => {
  const f = await start(),
    s = await state(f.id),
    actor = f.players.find(
      (p) => p.actor.id === s.order[s.currentIndex]
    )!.actor,
    id = s.hands[actor.id][0].id,
    requestId = randomUUID()
  await assert.rejects(
    () =>
      roomsA.command(actor, {
        roomId: f.id,
        action: 'PLAY',
        cardIds: [id, id],
        declaredRank: 'A',
        requestId,
      }),
    /only be played once/
  )
  assert.deepEqual(await state(f.id), s)
  await roomsB.command(actor, {
    roomId: f.id,
    action: 'PLAY',
    cardIds: [id],
    declaredRank: 'A',
    requestId,
  })
  assert.equal((await state(f.id)).pool.length, 1)
})
test('a delayed move from a previous game cannot mutate a new deal', async () => {
  const f = await start(),
    s = await state(f.id),
    actor = f.players.find((p) => p.actor.id === s.order[s.currentIndex])!.actor
  await assert.rejects(
    () =>
      roomsA.command(actor, {
        roomId: f.id,
        action: 'PLAY',
        cardIds: [s.hands[actor.id][0].id],
        declaredRank: 'A',
        gameId: randomUUID(),
        requestId: randomUUID(),
      }),
    /deal changed/
  )
  assert.deepEqual(await state(f.id), s)
})
test('simultaneous authentication cannot bind one live-session ID to two accounts', async () => {
  const [a, b] = await Promise.all([account(), account()]),
    session = randomUUID()
  const result = await Promise.allSettled([
    roomsA.authenticateSession(session, randomUUID(), a.actor),
    roomsB.authenticateSession(session, randomUUID(), b.actor),
  ])
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    (
      await first.query('SELECT count(*) FROM live_sessions WHERE id=$1', [
        session,
      ])
    ).rows[0].count,
    '1'
  )
})
test('host/root can recover a missing engine state and restore its wallet checkpoint', async () => {
  const f = await setup()
  await first.query(
    "UPDATE rooms SET status='IN_GAME',game_state=NULL WHERE id=$1",
    [f.id]
  )
  await first.query(
    'UPDATE room_memberships SET balance=900,game_start_balance=100 WHERE room_id=$1',
    [f.id]
  )
  const stopped = await roomsA.stop(f.id, f.host, null)
  assert.equal(stopped.game, null)
  assert.equal(stopped.status, 'LOBBY')
  assert.ok(stopped.players.every((p) => p.balance === 100))
  assert.ok(stopped.records.every((r) => r.wins === 0))
})
test('all engine room types inherit classic shop contents without sharing ownership or wallets', async () => {
  let expected: unknown
  for (const type of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'] as const) {
    const f = await setup(type)
    const view = await roomsA.view(f.id, f.host)
    const catalog = { skins: view.skins, avatars: view.avatars }
    if (!expected) expected = catalog
    else assert.deepEqual(catalog, expected)
    await first.query('UPDATE room_memberships SET balance=1000 WHERE room_id=$1 AND player_id=$2', [f.id, f.host.id])
    await roomsA.cosmetic(f.id, f.host, 'skins', 'AURORA', true)
    const own = await roomsA.view(f.id, f.host), other = await roomsB.view(f.id, f.players[1].actor)
    assert.equal(own.players.find(p => p.id === f.host.id)!.balance, 250)
    assert.equal(own.skins.find(s => s.id === 'AURORA')!.owned, true)
    assert.equal(other.skins.find(s => s.id === 'AURORA')!.owned, false)
    assert.equal(other.players.find(p => p.id === f.host.id)!.equippedSkin, 'AURORA')
    assert.equal(other.players.find(p => p.id !== f.host.id)!.balance, 0)
  }
})
test('4 Fun Plus survives cold reads and keeps the same players wallets, ownership and records separate from the original modes', async () => {
  const f = await setup('LIARS_DECK_4FUN_PLUS')
  const guest = f.players.find(player => player.actor.id !== f.host.id)!.actor
  const originals = [] as string[]
  for (const type of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN'] as const) {
    const original = await roomsA.create(f.host, `Separate ${type}`, type)
    roomIds.add(original.id)
    originals.push(original.id)
    await roomsA.join(original.id, guest)
  }
  await first.query('UPDATE room_memberships SET balance=1000 WHERE room_id=$1 AND player_id=$2', [f.id, f.host.id])
  await roomsA.cosmetic(f.id, f.host, 'skins', 'AURORA', true)
  await roomsA.start(f.id, f.host, { deckCount: 1, cardsPerPlayer: 3, randomDeckCount: true })
  const cold = await new Rooms(second).view(f.id, f.host)
  assert.equal(cold.gameType, 'LIARS_DECK_4FUN_PLUS')
  assert.equal(cold.game!.hand.filter(card => card.rank === 'SPELL').length, 1)
  assert.equal(cold.players.find(player => player.id === f.host.id)!.balance, 250)
  const s = await state(f.id)
  assert.equal(s.type, 'LIARS_DECK_4FUN_PLUS')
  assert.equal([...Object.values(s.hands).flat(), ...s.reserve].filter(card => card.rank === 'JOKER').length, s.deckCount * 2)
  s.order = [f.host.id, guest.id]
  s.currentIndex = s.initializerIndex = 0
  s.hands[f.host.id] = [{ id: randomUUID(), rank: 'SPELL', suit: 'SPADES' }]
  await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(s)])
  await roomsA.command(f.host, { roomId: f.id, action: 'PLAY', cardIds: [s.hands[f.host.id][0].id], declaredRank: 'A' })
  await roomsB.command(guest, { roomId: f.id, action: 'CHALLENGE' })
  const challenge = (await state(f.id)).spelling!
  for (const actor of [f.host, guest]) await roomsA.command(actor, {
    roomId: f.id, action: 'SPELL_ANSWER', spellingId: challenge.id, answer: challenge.questions[actor.id].text,
  })
  const won = await roomsB.view(f.id, f.host)
  assert.equal(won.game!.winnerId, f.host.id)
  assert.equal(won.records.find(record => record.playerId === f.host.id)!.wins, 1)
  for (const id of originals) {
    const view = await roomsB.view(id, f.host)
    assert.equal(view.game, null)
    assert.equal(view.players.find(player => player.id === f.host.id)!.balance, 0)
    assert.equal(view.skins.find(skin => skin.id === 'AURORA')!.owned, false)
    assert.equal(view.records.find(record => record.playerId === f.host.id)!.wins, 0)
  }
})

test('parallel purchases never overdraw a room wallet, and ownership is per player', async () => {
  const f = await setup()
  await first.query(
    'UPDATE room_memberships SET balance=1000 WHERE room_id=$1 AND player_id=$2',
    [f.id, f.host.id]
  )
  const results = await Promise.allSettled([
    roomsA.cosmetic(f.id, f.host, 'skins', 'AURORA', true),
    roomsB.cosmetic(f.id, f.host, 'avatars', 'PORTRAIT', true),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const own = await roomsA.view(f.id, f.host),
    other = await roomsB.view(f.id, f.players[1].actor)
  assert.ok(own.players[0].balance >= 0)
  assert.equal(other.skins.find((s) => s.id === 'AURORA')!.owned, false)
  assert.equal(other.avatars!.find((a) => a.id === 'PORTRAIT')!.owned, false)
})
test('manual force stop restores every wallet and leaves ranks unchanged', async () => {
  const f = await setup()
  await first.query(
    'UPDATE room_memberships SET balance=100 WHERE room_id=$1',
    [f.id]
  )
  await roomsA.start(f.id, f.host, { deckCount: 1, cardsPerPlayer: 3 })
  await play(f.id, f.players)
  await play(f.id, f.players)
  const s = await state(f.id)
  await assert.rejects(
    () => roomsA.stop(f.id, f.host, randomUUID()),
    /deal changed/
  )
  await roomsB.stop(f.id, f.host, s.gameId)
  const view = await roomsA.view(f.id, f.host)
  assert.equal(view.game, null)
  assert.deepEqual(
    view.players.map((p) => p.balance),
    [100, 100]
  )
  assert.ok(view.records.every((r) => r.wins === 0))
})
test('kicking a player preserves their wallet; rejoining later restores membership and ownership', async () => {
  const f = await setup()
  const guest = f.players[1].actor
  await first.query(
    'UPDATE room_memberships SET balance=2000 WHERE room_id=$1 AND player_id=$2',
    [f.id, guest.id]
  )
  await roomsA.cosmetic(f.id, guest, 'skins', 'AURORA', true)
  await roomsA.kick(f.id, f.host, guest.id)
  const joined = await roomsB.join(f.id, guest)
  assert.equal(joined.players.find((p) => p.id === guest.id)!.balance, 1250)
  assert.equal(joined.skins.find((s) => s.id === 'AURORA')!.owned, true)
})
test('expired presence removes a participant, restores all wallets at one player, and cannot resurrect a hand', async () => {
  const f = await start()
  await play(f.id, f.players)
  await play(f.id, f.players)
  const target = f.sessions[1]
  await first.query(
    "UPDATE live_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [target.id]
  )
  const view = await roomsB.view(f.id, f.host)
  assert.equal(view.status, 'LOBBY')
  assert.equal(view.game!.phase, 'FINISHED')
  assert.equal(view.game!.winnerId, null)
  assert.ok(view.players.every((p) => p.balance === 0))
  assert.equal(
    view.game!.hands.some((h) => h.playerId === target.actor.id),
    false
  )
})
test('one remaining live tab keeps an account active; stale connection close never evicts its replacement', async () => {
  const f = await start(),
    session = f.sessions[1],
    replacement = randomUUID()
  await roomsB.authenticateSession(session.id, replacement, session.actor)
  await roomsA.disconnect(session.id, session.connection)
  assert.equal((await roomsA.view(f.id, f.host)).game!.phase, 'ACTIVE')
  const extra = { id: randomUUID(), connection: randomUUID() }
  await roomsA.authenticateSession(extra.id, extra.connection, session.actor)
  await roomsA.enter(extra.id, extra.connection, f.id, session.actor)
  await roomsA.leave(session.id, replacement)
  assert.equal((await roomsB.view(f.id, f.host)).game!.phase, 'ACTIVE')
  await roomsA.leave(extra.id, extra.connection)
  assert.equal((await roomsB.view(f.id, f.host)).game!.phase, 'FINISHED')
})
test('expired sessions cannot re-enter an active game after reconnect', async () => {
  const f = await start('LIARS_DECK', 3),
    session = f.sessions[1]
  await first.query(
    "UPDATE live_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [session.id]
  )
  const replacement = randomUUID()
  await roomsA.authenticateSession(session.id, replacement, session.actor)
  await assert.rejects(
    () => roomsB.enter(session.id, replacement, f.id, session.actor),
    /not in this deal/
  )
  assert.equal((await roomsA.view(f.id, f.host)).game!.hands.length, 2)
})
for (const type of ['LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'] as const) {
  test(`${type}: cold-instance spelling settlement never gives the pool to a correct challenger`, async () => {
    const f = await start(type, 3)
    const [bystander, defender, challenger] = f.players.map(player => player.actor)
    const s = await state(f.id)
    s.order = [bystander.id, defender.id, challenger.id]
    s.currentIndex = s.initializerIndex = 0
    for (const actor of [bystander, defender, challenger]) s.hands[actor.id] = ['A', '2', '3'].map(rank => ({ id: randomUUID(), rank, suit: 'SPADES' }))
    s.hands[defender.id][0].rank = 'SPELL'
    await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(s)])
    await roomsA.command(bystander, { roomId: f.id, action: 'PLAY', cardIds: [s.hands[bystander.id][0].id], declaredRank: 'A' })
    await roomsB.command(defender, { roomId: f.id, action: 'PLAY', cardIds: [s.hands[defender.id][0].id] })
    const before = (await roomsA.view(f.id, f.host)).game!.hands
    await roomsA.command(challenger, { roomId: f.id, action: 'CHALLENGE' })
    const active = await state(f.id), round = active.spelling!
    assert.equal(round.penalty, 2)
    assert.deepEqual(round.penaltyCards!.map(card => card.id), [s.hands[bystander.id][0].id, s.hands[defender.id][0].id])
    for (const hand of before) assert.equal(active.hands[hand.playerId].length, hand.cardCount)
    await roomsB.command(defender, { roomId: f.id, action: 'SPELL_ANSWER', spellingId: round.id, answer: 'wrong' })
    await roomsA.command(challenger, { roomId: f.id, action: 'SPELL_ANSWER', spellingId: round.id, answer: round.questions[challenger.id].text })
    await roomsB.command(bystander, { roomId: f.id, action: 'SPELL_DRAFT', spellingId: round.id, answer: 'wrong' })
    const pending = await state(f.id)
    pending.spelling!.deadline = Date.now() - 100
    await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(pending)])
    const cold = new Rooms(second)
    const view = await cold.view(f.id, challenger)
    for (const hand of view.game!.hands) {
      const original = before.find(entry => entry.playerId === hand.playerId)!.cardCount
      assert.equal(hand.cardCount, original + (hand.playerId === challenger.id ? 0 : 2))
    }
    assert.equal(view.game!.outcomes!.at(-1)!.penaltyMode, 'SPELLING')
    assert.deepEqual((await cold.view(f.id, challenger)).game!.hands, view.game!.hands)
    const settled = await state(f.id)
    assert.deepEqual(settled.reserve, s.reserve)
    for (const actor of [bystander, defender]) {
      assert.ok(settled.hands[actor.id].some(card => card.rank === 'SPELL'))
      assert.ok(settled.hands[actor.id].some(card => card.rank === 'A'))
    }
    const supply = [...Object.values(settled.hands).flat(), ...settled.reserve]
    assert.equal(new Set(supply.map(card => card.id)).size, supply.length)
    // JSONB may reorder question keys; either wrong speller can hold the original.
    const copiedOwner = [bystander, defender].find(actor => settled.hands[actor.id].some(card => card.rank === 'SPELL' && card.id !== s.hands[defender.id][0].id))!
    const copiedSpell = settled.hands[copiedOwner.id].find(card => card.rank === 'SPELL')!
    let turn = settled
    while (turn.order[turn.currentIndex] !== copiedOwner.id) {
      const actor = f.players.find(player => player.actor.id === turn.order[turn.currentIndex])!.actor
      await roomsA.command(actor, turn.pool.length
        ? { roomId: f.id, action: 'FOLD' }
        : { roomId: f.id, action: 'PLAY', cardIds: [turn.hands[actor.id].find(card => card.rank !== 'SPELL')!.id], declaredRank: 'A' })
      turn = await state(f.id)
    }
    await roomsA.command(copiedOwner, { roomId: f.id, action: 'PLAY', cardIds: [copiedSpell.id], declaredRank: 'A' })
    turn = await state(f.id)
    const nextChecker = f.players.find(player => player.actor.id === turn.order[turn.currentIndex])!.actor
    await roomsB.command(nextChecker, { roomId: f.id, action: 'CHALLENGE' })
    const next = (await cold.view(f.id, challenger)).game!.spelling!
    assert.equal(next.stage, 'ACTIVE')
    assert.notEqual(next.id, round.id)
  })
}

test('spelling deadline settles correctly on a different cold instance and never draws twice', async () => {
  const f = await start('LIARS_DECK_4_FUN'),
    s = await state(f.id),
    actor = f.players.find((p) => p.actor.id === s.order[s.currentIndex])!.actor
  const spell = s.hands[actor.id].find((c) => c.rank === 'SPELL')!
  await roomsA.command(actor, {
    roomId: f.id,
    action: 'PLAY',
    cardIds: [spell.id],
    declaredRank: 'A',
  })
  const checker = f.players.find((p) => p.actor.id !== actor.id)!.actor
  await roomsB.command(checker, { roomId: f.id, action: 'CHALLENGE' })
  const active = await state(f.id),
    counts = Object.fromEntries(
      Object.entries(active.hands).map(([id, hand]) => [id, hand.length])
    )
  active.spelling!.deadline = Date.now() - 100
  await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [
    f.id,
    JSON.stringify(active),
  ])
  const fresh = new Rooms(second),
    view = await fresh.view(f.id, f.host)
  assert.equal(view.game!.spelling!.stage, 'COMPLETE')
  for (const hand of view.game!.hands)
    assert.equal(
      hand.cardCount,
      counts[hand.playerId] + active.spelling!.penalty
    )
  assert.deepEqual(
    (await fresh.view(f.id, f.host)).game!.hands,
    view.game!.hands
  )
})
test('winner ranks and bonus are recorded exactly once across independent reads', async () => {
  const f = await start(),
    s = await state(f.id),
    winner = f.host,
    other = f.players[1].actor
  s.order = [winner.id, other.id]
  s.currentIndex = 0
  s.initializerIndex = 0
  s.hands[winner.id] = [{ id: randomUUID(), rank: 'A', suit: 'SPADES' }]
  await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [
    f.id,
    JSON.stringify(s),
  ])
  await roomsA.command(winner, {
    roomId: f.id,
    action: 'PLAY',
    cardIds: [s.hands[winner.id][0].id],
    declaredRank: 'A',
  })
  await roomsB.command(other, { roomId: f.id, action: 'FOLD' })
  for (let i = 0; i < 3; i++) {
    const view = await (i % 2 ? roomsA : roomsB).view(f.id, winner)
    assert.equal(view.records.find((r) => r.playerId === winner.id)!.wins, 1)
    assert.equal(view.players.find((p) => p.id === winner.id)!.balance, 135)
  }
})
test('room deletion cascades purchases, commands and state but not persistent accounts', async () => {
  const f = await start()
  await play(f.id, f.players)
  await roomsA.delete(f.id, f.host)
  assert.equal(
    (
      await first.query(
        'SELECT count(*) FROM room_memberships WHERE room_id=$1',
        [f.id]
      )
    ).rows[0].count,
    '0'
  )
  assert.equal(
    (
      await first.query('SELECT count(*) FROM game_commands WHERE room_id=$1', [
        f.id,
      ])
    ).rows[0].count,
    '0'
  )
  assert.equal(
    (await identities.authenticate(f.players[0].token)).id,
    f.host.id
  )
})
test('HTTP validation and cloud root restrictions are enforced by the actual handler', async () => {
  const app = createApplication(first)
  await new Promise<void>((resolve) =>
    app.server.listen(0, '127.0.0.1', resolve)
  )
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const old = process.env.VERCEL
  try {
    assert.equal((await fetch(`${base}/api/rooms`)).status, 401)
    process.env.VERCEL = '1'
    const response = await fetch(`${base}/api/players`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        'X-Bluff-Root-Claim': 'local-server-runner',
      },
      body: JSON.stringify({
        displayName: 'Cloud newcomer',
        deviceToken: randomBytes(32).toString('hex'),
      }),
    })
    const player = (await response.json()) as { id: string; root: boolean }
    accounts.add(player.id)
    assert.equal(player.root, false)
    const malformed = await fetch(`${base}/api/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    assert.equal(malformed.status, 400)
  } finally {
    if (old === undefined) delete process.env.VERCEL
    else process.env.VERCEL = old
    await app.realtime.close()
    await new Promise<void>((resolve) => app.server.close(() => resolve()))
  }
})
test('WebSocket peers on separate server instances see the same game and survive instance rotation', async () => {
  const appA = createApplication(first),
    appB = createApplication(second)
  const wsClients: WebSocket[] = []
  for (const app of [appA, appB])
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve)
    )
  async function connect(
    app: ReturnType<typeof createApplication>,
    token: string,
    sessionId: string
  ) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`
    )
    wsClients.push(ws)
    const events: { type: string; payload: any }[] = []
    ws.on('message', (data) => events.push(JSON.parse(data.toString())))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.send(
      JSON.stringify({
        type: 'AUTH',
        payload: { deviceToken: token, sessionId },
      })
    )
    async function wait(
      predicate: (event: (typeof events)[number]) => boolean
    ) {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const found = [...events].reverse().find(predicate)
        if (found) return found
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('Timed out waiting for cross-instance live state')
    }
    await wait((e) => e.type === 'CONNECTED')
    return { ws, events, wait }
  }
  try {
    const host = await account(true),
      guest = await account(),
      room = await roomsA.create(host.actor, 'Cross instance', 'LIARS_DECK')
    roomIds.add(room.id)
    await roomsA.join(room.id, guest.actor)
    const rootSession = randomUUID(),
      botSession = randomUUID(),
      one = await connect(appA, host.token, rootSession),
      two = await connect(appB, guest.token, botSession)
    for (const peer of [one, two]) {
      peer.ws.send(
        JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId: room.id } })
      )
      await peer.wait(
        (e) => e.type === 'ROOM_STATE' && e.payload.id === room.id
      )
    }
    await roomsA.start(room.id, host.actor, { deckCount: 1, cardsPerPlayer: 3 })
    const [firstView, secondView] = await Promise.all([
      one.wait(
        (e) => e.type === 'ROOM_STATE' && e.payload.game?.phase === 'ACTIVE'
      ),
      two.wait(
        (e) => e.type === 'ROOM_STATE' && e.payload.game?.phase === 'ACTIVE'
      ),
    ])
    const actor =
        firstView.payload.game.currentPlayerId === host.actor.id ? one : two,
      view = actor === one ? firstView : secondView
    const buyerId = view.payload.game.currentPlayerId
    await first.query('UPDATE room_memberships SET balance=100 WHERE room_id=$1 AND player_id=$2', [room.id, buyerId])
    const tomatoRequest = randomUUID()
    const tomato = JSON.stringify({ type: 'GAME_COMMAND', payload: {
      roomId: room.id, gameId: view.payload.game.gameId, requestId: tomatoRequest,
      action: 'THROW', item: 'TOMATO', targetId: buyerId === host.actor.id ? guest.actor.id : host.actor.id,
    } })
    actor.ws.send(tomato)
    actor.ws.send(tomato)
    await actor.wait(event => event.type === 'THROW_CONFIRMED' && event.payload.requestId === tomatoRequest)
    const charged = await roomsA.view(room.id, buyerId === host.actor.id ? host.actor : guest.actor)
    assert.equal(charged.players.find(player => player.id === buyerId)!.balance, 0)
    assert.equal(charged.game!.throws!.length, 1)
    actor.ws.send(
      JSON.stringify({
        type: 'GAME_COMMAND',
        payload: {
          roomId: room.id,
          action: 'PLAY',
          cardIds: [view.payload.game.hand[0].id],
          declaredRank: 'A',
          requestId: randomUUID(),
        },
      })
    )
    await Promise.all([
      one.wait(
        (e) => e.type === 'ROOM_STATE' && e.payload.game?.poolSize === 1
      ),
      two.wait(
        (e) => e.type === 'ROOM_STATE' && e.payload.game?.poolSize === 1
      ),
    ])
    one.ws.close(1012, 'Server rotation')
    await new Promise<void>((resolve) => one.ws.once('close', () => resolve()))
    const reconnected = await connect(appB, host.token, rootSession)
    reconnected.ws.send(
      JSON.stringify({ type: 'SYNC_ROOM', payload: { roomId: room.id } })
    )
    const resumed = await reconnected.wait(
      (e) => e.type === 'ROOM_STATE' && e.payload.game?.poolSize === 1
    )
    assert.equal(resumed.payload.game.phase, 'ACTIVE')
    assert.equal(resumed.payload.game.gameId, firstView.payload.game.gameId)
  } finally {
    for (const ws of wsClients) ws.close()
    await appA.realtime.close()
    await appB.realtime.close()
    await Promise.all(
      [appA, appB].map(
        (app) =>
          new Promise<void>((resolve) => app.server.close(() => resolve()))
      )
    )
  }
})

test('throw purchase is charged once across instances, uses earnings first, and stop restores pre-deal wallets', async () => {
  const f = await setup()
  await first.query('UPDATE room_memberships SET balance=500 WHERE room_id=$1', [f.id])
  await roomsA.start(f.id, f.host, { deckCount: 1, cardsPerPlayer: 3 })
  const s = await state(f.id), target = f.players.find(player => player.actor.id !== f.host.id)!.actor
  s.earnings[f.host.id] = 220
  await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(s)])
  await first.query('UPDATE room_memberships SET balance=720 WHERE room_id=$1 AND player_id=$2', [f.id, f.host.id])
  const funded = await roomsB.view(f.id, f.host)
  assert.equal(funded.players.find(player => player.id === f.host.id)!.balance, 720)
  assert.equal(funded.game!.earnings.find(player => player.playerId === f.host.id)!.amount, 220)
  const command = { roomId: f.id, gameId: s.gameId, requestId: randomUUID(), action: 'THROW' as const, item: 'COFFEE' as const, targetId: target.id }
  await Promise.all([roomsA.command(f.host, command), roomsB.command(f.host, command)])
  const purchased = await roomsB.view(f.id, f.host)
  assert.equal(purchased.players.find(player => player.id === f.host.id)!.balance, 420)
  assert.equal(purchased.game!.throws!.length, 1)
  assert.equal(purchased.game!.throws![0].fromEarnings, 220)
  assert.equal(purchased.game!.throws![0].fromWallet, 80)
  await assert.rejects(() => roomsA.command(f.host, { ...command, gameId: randomUUID(), requestId: randomUUID() }), /deal changed/)
  await assert.rejects(() => roomsA.command(f.host, { ...command, item: 'AIRPLANE', requestId: randomUUID() }), /Not enough coins/)
  assert.equal((await roomsA.view(f.id, target)).game!.throws!.length, 1)
  const tomato = { ...command, item: 'TOMATO' as const, requestId: randomUUID() }
  await Promise.all([roomsA.command(f.host, tomato), roomsB.command(f.host, tomato)])
  const afterTomato = await roomsB.view(f.id, f.host)
  assert.equal(afterTomato.players.find(player => player.id === f.host.id)!.balance, 320)
  assert.equal(afterTomato.game!.throws!.length, 2)
  assert.equal(afterTomato.game!.throws![1].cost, 100)
  await roomsA.stop(f.id, f.host, s.gameId)
  const stopped = await roomsB.view(f.id, f.host)
  assert.ok(stopped.players.every(player => player.balance === 500))
  assert.equal(stopped.game, null)
})

for (const type of ['LIARS_DECK', 'LIARS_DECK_PLUS', 'LIARS_DECK_4_FUN', 'LIARS_DECK_4FUN_PLUS'] as const) {
  test(`${type}: continuous purchases across instances charge 100 per receipt and ignore pending coins`, async () => {
    const f = await setup(type)
    await first.query('UPDATE room_memberships SET balance=1000 WHERE room_id=$1', [f.id])
    await roomsA.start(f.id, f.host, { deckCount: 1, cardsPerPlayer: 3 })
    const s = await state(f.id), target = f.players.find(player => player.actor.id !== f.host.id)!.actor
    s.earnings[f.host.id] = 250
    s.pendingClaim = { playerId: f.host.id, cards: [], cardCount: 1, generation: 1, risk: 5000 }
    await first.query('UPDATE rooms SET game_state=$2::jsonb WHERE id=$1', [f.id, JSON.stringify(s)])
    await first.query('UPDATE room_memberships SET balance=1250 WHERE room_id=$1 AND player_id=$2', [f.id, f.host.id])
    const commands = Array.from({ length: 8 }, () => ({
      roomId: f.id, gameId: s.gameId, requestId: randomUUID(), action: 'THROW' as const, item: 'TOMATO' as const, targetId: target.id,
    }))
    const send = () => Promise.all(commands.map((command, index) => (index % 2 ? roomsA : roomsB).command(f.host, command)))
    await send()
    await send() // Replay every receipt; none may charge again.
    const view = await roomsA.view(f.id, f.host)
    assert.equal(view.players.find(player => player.id === f.host.id)!.balance, 450)
    assert.equal(view.game!.throws!.length, 8)
    assert.ok(view.game!.throws!.every(event => event.cost === 100))
    assert.deepEqual(view.game!.throwSpending!.find(player => player.playerId === f.host.id), { playerId: f.host.id, amount: 800, fromEarnings: 250 })
    const stored = await first.query('SELECT balance FROM room_memberships WHERE room_id=$1 AND player_id=$2', [f.id, f.host.id])
    assert.equal(Number(stored.rows[0].balance), 450)
    for (let index = 0; index < 4; index++) await roomsB.command(f.host, { ...commands[0], requestId: randomUUID() })
    await assert.rejects(() => roomsA.command(f.host, { ...commands[0], requestId: randomUUID() }), /Not enough coins/)
    assert.equal((await roomsB.view(f.id, f.host)).players.find(player => player.id === f.host.id)!.balance, 50)
    await roomsA.stop(f.id, f.host, s.gameId)
  })
}
