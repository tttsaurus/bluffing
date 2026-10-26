import { useEffect, useRef, useState } from 'react'
import { useGameStore } from './store'
import { Modal } from './Modal'
import type { SpellingView } from './types'

import { getPronunciationPlayer } from './pronunciationPlayer'

const MAX_PRONUNCIATION_GAIN = 5

export function SpellingChallenge() {
  const round = useGameStore(s => s.room?.game?.spelling)
  const [volume, setVolume] = useState(1)
  return round ? <Challenge key={round.id} round={round} volume={volume} onVolumeChange={setVolume} /> : null
}

function Challenge({ round, volume, onVolumeChange }: { round: SpellingView; volume: number; onVolumeChange: (value: number) => void }) {
  const { room, connected, command } = useGameStore()
  const audio = useRef<HTMLAudioElement>(null)
  const audioHost = useRef<HTMLDivElement>(null)
  const context = useRef<AudioContext | null>(null)
  const gain = useRef<GainNode | null>(null)
  const currentVolume = useRef(volume)
  currentVolume.current = volume
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sent, setSent] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((round.deadline - round.serverNow) / 1000)))
  const playing = round.stage === 'ACTIVE'
  const finished = !playing
  useEffect(() => {
    const received = performance.now()
    const update = () => setRemaining(Math.max(0, Math.ceil((round.deadline - round.serverNow - (performance.now() - received)) / 1000)))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [round.deadline, round.serverNow])
  useEffect(() => {
    if (!audioHost.current || !round.audioUrl) return
    const player = getPronunciationPlayer()
    audio.current = player.audio
    context.current = player.context
    gain.current = player.gain
    if (player.gain) player.gain.gain.value = currentVolume.current * MAX_PRONUNCIATION_GAIN
    else player.audio.volume = currentVolume.current
    audioHost.current.appendChild(player.audio)
    const reportError = () => setError(true)
    const updateAudioState = () => setSoundBlocked(Boolean(player.context && player.context.state !== 'running'))
    player.audio.addEventListener('error', reportError)
    player.context?.addEventListener('statechange', updateAudioState)
    player.audio.src = round.audioUrl
    updateAudioState()
    return () => {
      player.audio.pause()
      player.audio.removeEventListener('error', reportError)
      player.context?.removeEventListener('statechange', updateAudioState)
      player.audio.remove()
      audio.current = null
      context.current = null
      gain.current = null
    }
  }, [round.audioUrl])
  useEffect(() => {
    if (gain.current) gain.current.gain.value = volume * MAX_PRONUNCIATION_GAIN
    else if (audio.current) audio.current.volume = volume
  }, [volume])
  useEffect(() => {
    if (!audio.current) return
    if (!playing) { audio.current.pause(); return }
    input.current?.focus()
    const element = audio.current
    let cancelled = false
    void (async () => {
      try {
        await context.current?.resume()
        if (cancelled) return
        element.currentTime = 0
        await element.play()
      } catch { if (!cancelled) setSoundBlocked(true) }
    })()
    return () => { cancelled = true; element.pause() }
  }, [playing])
  useEffect(() => {
    if (!connected) { setSent(false) }
  }, [connected])
  if (dismissed && finished) return null
  const playAudio = async () => {
    if (!audio.current) return
    try {
      setError(false)
      audio.current.currentTime = 0
      await Promise.all([context.current?.resume(), audio.current.play()])
    }
    catch { setSoundBlocked(true); setError(true) }
  }
  return <Modal label="Spelling challenge" className="spelling-dialog" onClose={() => { if (finished) setDismissed(true) }}>
    <section className="spelling-challenge">
    <div className="spelling-heading"><div><p className="eyebrow">SPELL · EVERYONE PLAYS</p><h2>{playing ? 'Spell the word.' : round.stage === 'CANCELLED' ? 'Challenge cancelled' : 'The verdict is in.'}</h2></div>
      {!finished && <strong className={`spelling-clock ${remaining <= 3 && playing ? 'urgent' : ''}`} aria-label={`${remaining} seconds remaining`}>{remaining}<small>SEC</small></strong>}
    </div>
    <div ref={audioHost} hidden />
    {playing && !round.audioUrl && <p>Spectating</p>}
    {playing && round.audioUrl && <form onSubmit={event => { event.preventDefault(); if (!sent && !round.submitted && remaining > 0 && answer.trim()) { setSent(true); command('SPELL_ANSWER', [], undefined, round.id, answer) } }}>
      <div className="spelling-audio-controls">
        <button type="button" className="secondary" onClick={() => void playAudio()}>{soundBlocked ? '▶ Enable sound' : '▶ Replay pronunciation'}</button>
        <label className="spelling-volume" htmlFor={`spelling-volume-${round.id}`}>
          <span>Volume</span>
          <input id={`spelling-volume-${round.id}`} type="range" aria-label="Volume" min="0" max="100" step="1" value={Math.round(volume * 100)} onChange={event => onVolumeChange(Number(event.target.value) / 100)} />
          <output htmlFor={`spelling-volume-${round.id}`}>{Math.round(volume * 100)}%</output>
        </label>
      </div>
      <label htmlFor={`spelling-${round.id}`}>YOUR SPELLING</label>
      <div className="spelling-input"><input ref={input} id={`spelling-${round.id}`} autoFocus value={answer} onChange={event => {
        const value = event.target.value
        setAnswer(value)
        if (connected && !sent && !round.submitted && remaining > 0) command('SPELL_DRAFT', [], undefined, round.id, value)
      }} maxLength={64} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} disabled={!connected || sent || round.submitted || remaining === 0} placeholder="Type the word…" />
        <button className="primary" disabled={!connected || sent || round.submitted || remaining === 0 || !answer.trim()}>{round.submitted || sent ? 'Submitted' : 'Submit'}</button></div>
      <p role="status">{round.submittedCount}/{round.playerCount} submitted</p>
    </form>}
    {error && !finished && <p role="alert">Audio unavailable. <button onClick={() => { setError(false); audio.current?.load() }}>Reload audio</button></p>}
    {!connected && !finished && <p role="alert">Reconnecting…</p>}
    {round.stage === 'COMPLETE' && <div className="spelling-results">{round.results.map(result => {
      const member = room?.players.find(player => player.id === result.playerId)
      return <div key={result.playerId} className={result.correct ? 'correct' : 'incorrect'}><strong>{member ? `${member.displayName} #${member.identityTag}` : 'Player'}</strong><span><b>{result.word}</b><small>{result.answer || '(no answer)'}</small></span><b>{result.correct ? '✓ Correct' : `+${result.drawn} cards`}</b></div>
    })}</div>}
    {round.stage === 'CANCELLED' && <p>Challenge ended.</p>}
    <div className="spelling-footer"><a href="/api/spelling/credits" target="_blank" rel="noreferrer">Pronunciation credits</a>{finished && <button className="secondary" onClick={() => setDismissed(true)}>Back to the table</button>}</div>
  </section>
  </Modal>
}
