import { test } from 'node:test'
import assert from 'node:assert/strict'
import { databaseUrl, port } from '../src/config.ts'
import * as v from '../src/validation.ts'
import {
  migrationChecksum,
  migrationFiles
} from '../../scripts/db/migrate.ts'
import { databaseStartupError } from '../../scripts/db/startup-error.ts'
test('database startup errors explain how to start local PG without leaking credentials', () => {
  const url =
    'postgresql://secret-user:secret-password@127.0.0.1:5432/secret-db'
  const message = databaseStartupError(
    { code: 'ECONNREFUSED' },
    url
  ).message
  assert.match(message, /127\.0\.0\.1:5432/)
  assert.match(message, /podman start blufftable-db/)
  assert.doesNotMatch(message, /secret-/)
})
test('nested connection errors distinguish Neon, authentication and missing databases', () => {
  const url = 'postgresql://owner:secret@ep-test.neon.tech/neondb'
  assert.match(
    databaseStartupError(
      new AggregateError([{ code: 'ECONNREFUSED' }]),
      url
    ).message,
    /For Neon/
  )
  assert.match(
    databaseStartupError({ cause: { code: 'ENOTFOUND' } }, url).message,
    /Cannot reach PostgreSQL/
  )
  assert.match(
    databaseStartupError({ code: '28P01' }, url).message,
    /authentication failed/
  )
  assert.match(
    databaseStartupError({ code: '3D000' }, url).message,
    /does not exist/
  )
  const migrationError = new Error(
    'Migration history or checksum mismatch'
  )
  assert.equal(databaseStartupError(migrationError, url), migrationError)
})
test('Neon pooled traffic and direct migrations resolve independently', () => {
  const env = {
    DATABASE_URL: 'postgresql://user@pooler/db',
    DATABASE_URL_UNPOOLED: 'postgresql://user@direct/db'
  }
  assert.equal(databaseUrl(false, env), env.DATABASE_URL)
  assert.equal(databaseUrl(true, env), env.DATABASE_URL_UNPOOLED)
  assert.equal(
    databaseUrl(true, { DATABASE_URL: env.DATABASE_URL }),
    env.DATABASE_URL
  )
})
test('cloud cannot silently connect to a default localhost database', () => {
  assert.throws(() => databaseUrl(false, { VERCEL: '1' }))
  assert.throws(() =>
    databaseUrl(false, { DATABASE_URL: 'jdbc:postgresql://localhost/db' })
  )
  assert.match(databaseUrl(false, {}), /127\.0\.0\.1/)
})
test('migration refuses mismatched Neon preview/production branch URLs and legacy JDBC-only settings', () => {
  const DATABASE_URL =
    'postgresql://user@ep-preview-pooler.us-east-2.aws.neon.tech/neondb'
  assert.throws(
    () =>
      databaseUrl(true, {
        DATABASE_URL,
        DATABASE_URL_UNPOOLED:
          'postgresql://owner@ep-production.us-east-2.aws.neon.tech/neondb'
      }),
    /same branch/
  )
  assert.throws(
    () =>
      databaseUrl(false, {
        DB_URL: 'jdbc:postgresql://localhost:5432/old'
      }),
    /legacy JDBC/
  )
  const direct =
    'postgresql://owner@ep-preview.us-east-2.aws.neon.tech/neondb'
  assert.equal(
    databaseUrl(true, { DATABASE_URL, DATABASE_URL_UNPOOLED: direct }),
    direct
  )
})
test('ports are strictly validated', () => {
  for (const value of ['0', '65536', '-1', 'abc', '80;exit'])
    assert.throws(() => port(value))
  assert.equal(port('8080'), 8080)
})
test('HTTP and socket validation reject malformed types before touching the database', () => {
  assert.equal(
    v.createRoom.safeParse({ name: 'table', gameType: 'UNKNOWN' }).success,
    false
  )
  assert.equal(
    v.startGame.safeParse({ deckCount: 1.5, cardsPerPlayer: 3 }).success,
    false
  )
  assert.equal(
    v.identify.safeParse({ displayName: ' ', deviceToken: 'x'.repeat(32) })
      .success,
    false
  )
  assert.equal(
    v.socketMessage.safeParse({
      type: 'AUTH',
      payload: { deviceToken: 'x' }
    }).success,
    false
  )
  assert.equal(
    v.command.safeParse({
      roomId: 'not-a-uuid',
      action: 'PLAY',
      cardIds: []
    }).success,
    false
  )
})
test('migration checksums are identical on Linux, macOS and Windows line endings', () => {
  assert.equal(
    migrationChecksum('SELECT 1;\nSELECT 2;\n'),
    migrationChecksum('\uFEFFSELECT 1;\r\nSELECT 2;\r\n')
  )
})
test('the full legacy SQL history is discoverable independently of the caller working directory', async () => {
  const files = await migrationFiles()
  assert.deepEqual(
    files.map((file) => file.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  )
})
