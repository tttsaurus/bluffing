import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SpellingChallenge } from '../src/SpellingChallenge'
import { useGameStore } from '../src/store'
import type { SpellingView } from '../src/types'
import { game, room, self, other } from './fixtures'

const amplifiers: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
vi.stubGlobal('AudioContext', class {
  destination = {}
  state = 'running'
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  resume = vi.fn().mockResolvedValue(undefined)
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  createGain() {
    const amplifier = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
    amplifiers.push(amplifier)
    return amplifier
  }
})

const command = vi.fn()
function show(overrides: Partial<SpellingView> = {}) {
  const spelling: SpellingView = { id: 'challenge-one', stage: 'ACTIVE', serverNow: 1000, deadline: 16000,
    penalty: 7, audioUrl: '/api/spelling/audio/opaque-id', submitted: false,
    submittedCount: 0, playerCount: 2, results: [], ...overrides }
  useGameStore.setState({ room: room({ game: game({ spelling }) }), player: self, connected: true, command })
}
beforeEach(() => {
  command.mockClear()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  show()
})
afterEach(() => vi.useRealTimers())

it('starts immediately with audio and input, without readiness controls or rule prose', async () => {
  render(<SpellingChallenge />)
  expect(screen.getByRole('textbox')).toBeTruthy()
  expect(screen.getByLabelText('15 seconds remaining')).toBeTruthy()
  await act(async () => {})
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /ready/i })).toBeNull()
  expect(screen.queryByText(/wrong or late|preparation|one submission/i)).toBeNull()
})
it('amplifies pronunciation to five times its original level with a normalized volume slider and adjusts or mutes without replaying', () => {
  const { unmount } = render(<SpellingChallenge />)
  const amplifier = amplifiers.at(-1)!
  const slider = screen.getByRole('slider', { name: 'Volume' })
  expect(slider.getAttribute('max')).toBe('100')
  expect(amplifier.gain.value).toBe(5)
  expect((slider as HTMLInputElement).value).toBe('100')
  expect(screen.getByText('100%')).toBeTruthy()
  const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length
  fireEvent.change(slider, { target: { value: '50' } })
  expect(amplifier.gain.value).toBe(2.5)
  fireEvent.change(slider, { target: { value: '0' } })
  expect(amplifier.gain.value).toBe(0)
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount)
  unmount()
  expect(amplifier.disconnect).not.toHaveBeenCalled()
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
})
it('submits once with a round ID and disables spelling assistance', () => {
  show({ stage: 'ACTIVE', deadline: 16000 })
  render(<SpellingChallenge />)
  const input = screen.getByRole('textbox')
  expect(input.getAttribute('spellcheck')).toBe('false')
  expect(input.getAttribute('autocorrect')).toBe('off')
  fireEvent.change(input, { target: { value: 'hypothesis' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.submit(input.closest('form')!)
  expect(command.mock.calls.filter(call => call[0] === 'SPELL_ANSWER')).toHaveLength(1)
  expect(command).toHaveBeenCalledWith('SPELL_ANSWER', [], undefined, 'challenge-one', 'hypothesis')
  expect(input.hasAttribute('disabled')).toBe(true)
})
it('uses server time and blocks late submissions', () => {
  vi.useFakeTimers()
  show({ stage: 'ACTIVE', serverNow: 5000, deadline: 6000 })
  render(<SpellingChallenge />)
  expect(screen.getByLabelText('1 seconds remaining')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1100))
  expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText('0 seconds remaining')).toBeTruthy()
})
it('spectators receive no word input or ready control', () => {
  show({ audioUrl: null })
  render(<SpellingChallenge />)
  expect(screen.getByText('Spectating')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /ready/i })).toBeNull()
})
it('shows answers and individual penalties only after settlement', () => {
  show({ stage: 'COMPLETE', results: [{ playerId: self.id, word: 'hypothesis', answer: 'hypotesis', correct: false, drawn: 7 }] })
  render(<SpellingChallenge />)
  expect(screen.getByText('hypothesis')).toBeTruthy()
  expect(screen.getByText('+7 cards')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to the table' }))
  expect(screen.queryByLabelText('Spelling challenge')).toBeNull()
})
it('keeps penalties attached to player IDs even when nicknames match and result order is reversed', () => {
  show({ stage: 'COMPLETE', results: [
    { playerId: other.id, word: 'quiet', answer: 'quiet', correct: true, drawn: 0 },
    { playerId: self.id, word: 'quiet', answer: 'wrong', correct: false, drawn: 7 },
  ] })
  render(<SpellingChallenge />)
  const correct = screen.getByText(`${other.displayName} #${other.identityTag}`).closest('div')!
  const wrong = screen.getByText(`${self.displayName} #${self.identityTag}`).closest('div')!
  expect(within(correct).getByText('✓ Correct')).toBeTruthy()
  expect(within(correct).queryByText('+7 cards')).toBeNull()
  expect(within(wrong).getByText('+7 cards')).toBeTruthy()
  expect(within(wrong).queryByText('✓ Correct')).toBeNull()
})
it('reports failed audio and allows reload during the countdown', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const { container } = render(<SpellingChallenge />)
  fireEvent.error(container.querySelector('audio')!)
  expect(screen.getByRole('alert').textContent).toContain('Audio unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Reload audio' }))
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
})

it('saves edits and clearing for server-side automatic submission at the deadline', () => {
  vi.useFakeTimers()
  render(<SpellingChallenge />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'first' } })
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.change(input, { target: { value: 'finalword' } })
  expect(command.mock.calls).toEqual([
    ['SPELL_DRAFT', [], undefined, 'challenge-one', 'first'],
    ['SPELL_DRAFT', [], undefined, 'challenge-one', ''],
    ['SPELL_DRAFT', [], undefined, 'challenge-one', 'finalword'],
  ])
  act(() => vi.advanceTimersByTime(15000))
  expect(input.hasAttribute('disabled')).toBe(true)
  expect(command).toHaveBeenCalledTimes(3)
})

it('reuses the unlocked player across completed challenges and component remounts', async () => {
  const first = render(<SpellingChallenge />)
  await act(async () => {})
  const audio = first.container.querySelector('audio')!
  const amplifier = amplifiers.at(-1)!
  const count = amplifiers.length
  act(() => show({ stage: 'COMPLETE' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to the table' }))
  act(() => show({ id: 'challenge-two', audioUrl: '/api/spelling/audio/second-word' }))
  await act(async () => {})
  expect(first.container.querySelector('audio')).toBe(audio)
  expect(audio.getAttribute('src')).toBe('/api/spelling/audio/second-word')
  expect(amplifiers).toHaveLength(count)
  first.unmount()
  show({ id: 'challenge-three' })
  const third = render(<SpellingChallenge />)
  await act(async () => {})
  expect(third.container.querySelector('audio')).toBe(audio)
  expect(amplifiers.at(-1)).toBe(amplifier)
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3)
})
