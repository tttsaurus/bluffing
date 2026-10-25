import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('falls back to ordinary audio when Web Audio is denied instead of crashing the spelling screen', async () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Audio disabled by browser') } })
  const { getPronunciationPlayer } = await import('../src/pronunciationPlayer')
  const player = getPronunciationPlayer()
  expect(player.audio).toBeInstanceOf(HTMLAudioElement)
  expect(player.context).toBeNull()
  expect(player.gain).toBeNull()
  expect(getPronunciationPlayer()).toBe(player)
})

it('supports browsers without AudioContext', async () => {
  vi.stubGlobal('AudioContext', undefined)
  const { getPronunciationPlayer } = await import('../src/pronunciationPlayer')
  expect(getPronunciationPlayer().audio).toBeInstanceOf(HTMLAudioElement)
})
