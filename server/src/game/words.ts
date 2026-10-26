import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import type { Word } from './state.ts'

// Vercel preserves the module tree; the local esbuild bundle lives in server/dist.
// Resolve both layouts from this module so cold starts do not depend on cwd.
const resourceDirectories = ['../../resources/spelling/', '../resources/spelling/']
  .map((path) => fileURLToPath(new URL(path, import.meta.url)))
const resourceDirectory = resourceDirectories.find((path) =>
  existsSync(resolve(path, 'words.tsv'))
)
if (!resourceDirectory) throw new Error('Missing packaged spelling resources')
export const directory = resourceDirectory
export const words: Word[] = readFileSync(
  resolve(directory, 'words.tsv'),
  'utf8'
)
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [id, text, alternatives = ''] = line.split('\t')
    return {
      id,
      text,
      alternatives: alternatives ? alternatives.split(',') : [],
    }
  })
export interface Pronunciation {
  id: string
  url: string
  [key: string]: string
}
export const pronunciations: Pronunciation[] = JSON.parse(
  readFileSync(resolve(directory, 'audio-manifest.json'), 'utf8')
)
export const audioSources = new Map(
  pronunciations.map((item) => [item.id, item])
)
const wordIds = new Set(words.map((word) => word.id))
if (
  words.length !== 2000 ||
  new Set(words.map((word) => word.id)).size !== 2000 ||
  new Set(words.map((word) => word.text)).size !== 2000 ||
  audioSources.size !== 2000 ||
  words.some((word) => !word.id || !word.text) ||
  pronunciations.some(
    (item) =>
      !wordIds.has(item.id) ||
      new URL(item.url).origin !== 'https://upload.wikimedia.org'
  )
) {
  throw new Error('Invalid spelling vocabulary or pronunciation manifest')
}
export function pickWord(used: string[]): Word {
  if (used.length >= words.length) used.splice(0)
  const available = words.filter((word) => !used.includes(word.id))
  const selected = available[randomInt(available.length)]
  used.push(selected.id)
  return selected
}
