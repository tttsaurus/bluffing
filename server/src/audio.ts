import { invariant } from './errors.ts'
import { audioSources } from './game/words.ts'

const MAX_BYTES = 4 * 1024 * 1024
const downloads = new Map<string, Promise<Buffer>>()

/** Deduplicate peers hearing the same word and bound memory on self-hosted and Fluid instances. */
export async function pronunciation(id: string): Promise<Buffer> {
  const source = audioSources.get(id)
  invariant(source, 'Unknown pronunciation', 404)
  const existing = downloads.get(id)
  if (existing) return existing
  invariant(
    downloads.size < 4,
    'Pronunciation downloads are busy; please replay in a moment',
    503
  )
  const job = (async () => {
    const remote = await fetch(source.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'BluffTableVocabulary/2.0' },
    })
    invariant(remote.ok && remote.body, 'Pronunciation source unavailable', 502)
    const reader = remote.body.getReader()
    try {
      invariant(
        Number(remote.headers.get('content-length') ?? 0) <= MAX_BYTES,
        'Pronunciation exceeds size limit',
        502
      )
      const chunks: Uint8Array[] = []
      let bytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        invariant(bytes <= MAX_BYTES, 'Pronunciation exceeds size limit', 502)
        chunks.push(value)
      }
      invariant(bytes > 0, 'Empty pronunciation', 502)
      return Buffer.concat(chunks)
    } finally {
      await reader.cancel().catch(() => {})
    }
  })().finally(() => downloads.delete(id))
  downloads.set(id, job)
  return job
}
