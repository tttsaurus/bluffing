import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the Vercel function runs as emitted JavaScript with only its packaged spelling assets', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bluff-vercel-'))
  try {
    const configPath = join(root, 'tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    assert.equal(config.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
    const program = ts.createProgram([join(root, 'api/server.ts')], {
      ...parsed.options, noEmit: false, rootDir: root, outDir: fixture,
    })
    const emitted = program.emit()
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }))
    for (const path of ['package.json', 'server/package.json'])
      cpSync(join(root, path), join(fixture, path))
    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
    assert.equal(vercel.functions['api/server.ts'].includeFiles, 'server/resources/spelling/**')
    cpSync(join(root, 'server/resources/spelling'), join(fixture, 'server/resources/spelling'), { recursive: true })
    buildSync({
      entryPoints: [join(root, 'server/src/game/words.ts')],
      outfile: join(fixture, 'server/dist/words.js'),
      bundle: true, platform: 'node', format: 'esm', packages: 'external',
    })
    for (const path of ['node_modules', 'server/node_modules'])
      symlinkSync(join(root, path), join(fixture, path), process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(join(fixture, 'unrelated-working-directory'))
    writeFileSync(join(fixture, 'smoke.mjs'), `
import assert from 'node:assert/strict'
import server from './api/server.js'
import { createApplication } from './server/src/http.js'
import { words, audioSources } from './server/src/game/words.js'
import { words as bundledWords } from './server/dist/words.js'
assert.equal(typeof server.listen, 'function')
assert.equal(words.length, 2000)
assert.equal(audioSources.size, 2000)
assert.equal(bundledWords.length, 2000)
let queries = 0
const app = createApplication({ async query(sql) {
  assert.equal(sql, 'SELECT 1')
  queries++
  return { rows: [{ '?column?': 1 }] }
} })
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + app.server.address().port
  const health = await fetch(origin + '/api/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'ok')
  assert.equal(queries, 1)
  const credits = await fetch(origin + '/api/spelling/credits')
  assert.equal(credits.status, 200)
  assert.match(await credits.text(), /Wikimedia/)
  const identify = await fetch(origin + '/api/players', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  assert.equal(identify.status, 400)
} finally {
  await app.realtime.close()
  await new Promise(resolve => app.server.close(resolve))
}
`)
    for (const cwd of [fixture, join(fixture, 'server'), join(fixture, 'unrelated-working-directory')]) {
      const result = spawnSync(process.execPath, [join(fixture, 'smoke.mjs')], {
        cwd, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, NODE_OPTIONS: '', VERCEL: '1', DATABASE_URL: 'postgresql://unused@127.0.0.1/unused' },
      })
      assert.equal(result.status, 0, result.stderr || String(result.error))
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
