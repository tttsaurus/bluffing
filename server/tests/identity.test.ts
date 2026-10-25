import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isLocalRoot, tokenHash, playerView } from '../src/identity.ts'
const headers = {
  origin: 'http://localhost:5173',
  host: '127.0.0.1:8080',
  'x-bluff-root-claim': 'local-server-runner',
}
test('only direct local server requests grant implicit root', () => {
  assert.equal(isLocalRoot('127.0.0.1', headers, {}), true)
  for (const remote of ['10.0.0.1', '100.64.0.1', undefined])
    assert.equal(isLocalRoot(remote, headers, {}), false)
  for (const origin of [
    'https://example.com',
    'https://device.ts.net',
    'malformed',
  ])
    assert.equal(isLocalRoot('127.0.0.1', { ...headers, origin }, {}), false)
  assert.equal(
    isLocalRoot('127.0.0.1', { ...headers, 'x-bluff-proxied': 'true' }, {}),
    false
  )
  assert.equal(
    isLocalRoot('127.0.0.1', { ...headers, host: 'evil.example' }, {}),
    false
  )
  assert.equal(
    isLocalRoot('127.0.0.1', headers, { ALLOW_LOCAL_ROOT: 'false' }),
    false
  )
})
test('Vercel disables implicit root even with forged loopback headers and explicit opt-in', () => {
  assert.equal(
    isLocalRoot('127.0.0.1', headers, {
      VERCEL: '1',
      ALLOW_LOCAL_ROOT: 'true',
    }),
    false
  )
})
test('device credentials retain Java-compatible SHA-256 and reject invalid lengths', () => {
  const token = 'a'.repeat(43)
  assert.equal(
    tokenHash(token),
    createHash('sha256').update(token).digest('hex')
  )
  for (const value of ['', 'a'.repeat(31), 'a'.repeat(201)])
    assert.throws(() => tokenHash(value))
})
test('player views expose a stable hash tag, never the bearer credential or debug owner', () => {
  const view = playerView({
    id: 'abcde000-0000-4000-8000-000000000000',
    display_name: 'Name',
    root_account: false,
    device_token_hash: 'secret',
    debug_owner_id: 'secret-owner',
  })
  assert.deepEqual(view, {
    id: 'abcde000-0000-4000-8000-000000000000',
    displayName: 'Name',
    root: false,
    identityTag: 'abcde',
  })
})
