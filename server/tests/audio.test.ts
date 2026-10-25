import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pronunciation } from '../src/audio.ts'
import { pronunciations } from '../src/game/words.ts'
const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
test('audio IDs must exist in the allowlisted catalog before any network request', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response('audio')
  }
  await assert.rejects(
    () => pronunciation('../../secret'),
    /Unknown pronunciation/
  )
  assert.equal(calls, 0)
})
test('same-word requests share a bounded download and preserve bytes', async () => {
  let calls = 0,
    release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async (input, options) => {
    calls++
    assert.equal(new URL(String(input)).origin, 'https://upload.wikimedia.org')
    assert.equal(options?.redirect, 'error')
    await gate
    return new Response('audio bytes')
  }
  const one = pronunciation(pronunciations[0].id),
    two = pronunciation(pronunciations[0].id)
  release()
  const [a, b] = await Promise.all([one, two])
  assert.equal(a.toString(), 'audio bytes')
  assert.deepEqual(a, b)
  assert.equal(calls, 1)
})
test('upstream failure and oversized recordings fail safely and release download slots', async () => {
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  await assert.rejects(
    () => pronunciation(pronunciations[0].id),
    /source unavailable/
  )
  globalThis.fetch = async () =>
    new Response('small', {
      headers: { 'content-length': String(5 * 1024 * 1024) },
    })
  await assert.rejects(() => pronunciation(pronunciations[0].id), /size limit/)
  globalThis.fetch = async () => new Response('')
  await assert.rejects(
    () => pronunciation(pronunciations[0].id),
    /Empty pronunciation/
  )
  globalThis.fetch = async () => new Response('recovered')
  assert.equal(
    (await pronunciation(pronunciations[0].id)).toString(),
    'recovered'
  )
})
test('at most four distinct recordings download concurrently', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async () => {
    await gate
    return new Response('bytes')
  }
  const four = pronunciations
    .slice(0, 4)
    .map((source) => pronunciation(source.id))
  try {
    await assert.rejects(
      () => pronunciation(pronunciations[4].id),
      /downloads are busy/
    )
  } finally {
    release()
    await Promise.all(four)
  }
})
