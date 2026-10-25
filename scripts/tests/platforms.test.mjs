import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
test('macOS help and invalid options exit before touching Homebrew or PostgreSQL', { skip: process.platform === 'win32' }, () => {
  const help = spawnSync('bash', [join(root, 'scripts/macos/start.sh'), '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage:/)
  const invalid = spawnSync('bash', [join(root, 'scripts/macos/start.sh'), '--invalid'], { encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /Unknown argument/)
  for (const args of [['--help'], ['--invalid']]) {
    const stop = spawnSync('bash', [join(root, 'scripts/macos/stop-db.sh'), ...args], { encoding: 'utf8' })
    assert.equal(stop.status, args[0] === '--help' ? 0 : 2, stop.stderr)
  }
})
test('macOS Tailscale adapter falls back to an installed CLI', { skip: process.platform === 'win32' }, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bluff-platform-'))
  try {
    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nprintf "native:%s\\n" "$1"\n', { mode: 0o755 })
    const result = spawnSync(join(root, 'scripts/macos/bin/tailscale'), ['status'], {
      env: { ...process.env, PATH: `${join(root, 'scripts/macos/bin')}:${bin}:/usr/bin:/bin` }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'native:status')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test('Unix launcher works outside the repository and forwards help without a database', { skip: process.platform === 'win32' }, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bluff-entrypoint-'))
  try {
    const result = spawnSync('bash', [join(root, 'scripts/start-dev.sh'), '--help'], { cwd: fixture, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage: npm run dev/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
