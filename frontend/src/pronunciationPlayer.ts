/** Reuse the same media element and audio graph across challenges and games. */
interface PronunciationPlayer {
  audio: HTMLAudioElement
  context: AudioContext | null
  gain: GainNode | null
}
const runtime: { player?: PronunciationPlayer } = import.meta.hot?.data.pronunciationPlayer ?? {}
if (import.meta.hot) import.meta.hot.data.pronunciationPlayer = runtime

export function getPronunciationPlayer(): PronunciationPlayer {
  if (!runtime.player) {
    let audio = new Audio()
    audio.preload = 'auto'
    // Web Audio may be unavailable or denied by browser/privacy settings. The
    // spelling screen must still open, using ordinary media playback instead.
    let context: AudioContext | null = null
    let gain: GainNode | null = null
    try {
      context = new AudioContext()
      gain = context.createGain()
      const source = context.createMediaElementSource(audio)
      source.connect(gain)
      gain.connect(context.destination)
    } catch {
      void context?.close().catch(() => {})
      context = null
      gain = null
      // Once attached to a failed audio graph, a media element can remain silent.
      audio = new Audio()
      audio.preload = 'auto'
    }
    runtime.player = { audio, context, gain }
  }
  return runtime.player
}
