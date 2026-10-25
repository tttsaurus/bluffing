import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'

test('every workspace uses the same portable compiler on Linux, macOS and Windows', () => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const root = read('../../package.json')
  const frontend = read('../../frontend/package.json')
  const lock = read('../../package-lock.json')
  assert.equal(root.devDependencies.typescript, '6.0.3')
  assert.equal(frontend.devDependencies.typescript, root.devDependencies.typescript)
  const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url))
  assert.equal(frontendRequire('typescript/package.json').version, root.devDependencies.typescript)
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path.endsWith('/typescript')) {
      assert.equal(entry.version, root.devDependencies.typescript)
      assert.equal(entry.optionalDependencies, undefined, 'Compiler must not rely on platform-specific optional binaries')
    }
    assert.ok(!path.includes('/@typescript/typescript-'), `Unexpected native compiler: ${path}`)
  }
})

test('native build tools lock their Linux, macOS and Windows optional binaries', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'))
  for (const name of ['esbuild', 'rolldown', 'lightningcss']) {
    const entry = lock.packages[`node_modules/${name}`]
    for (const [binary, version] of Object.entries(entry.optionalDependencies)) {
      if (!/darwin|win32|linux/.test(binary)) continue
      assert.equal(lock.packages[`node_modules/${binary}`]?.version, version, `Missing locked platform binary: ${binary}`)
    }
  }
})
