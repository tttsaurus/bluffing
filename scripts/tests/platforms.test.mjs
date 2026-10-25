import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
test('macOS help and invalid options exit before touching Homebrew or PostgreSQL', () => {
  const help = spawnSync('bash', [join(root, 'scripts/start-local-macos.sh'), '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage:/)
  const invalid = spawnSync('bash', [join(root, 'scripts/start-local-macos.sh'), '--invalid'], { encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /Unknown argument/)
})
test('macOS Tailscale adapter falls back to an installed CLI', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bluff-platform-'))
  try {
    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nprintf "native:%s\\n" "$1"\n', { mode: 0o755 })
    const result = spawnSync('bash', [join(root, 'scripts/macos-bin/tailscale'), 'status'], {
      env: { ...process.env, PATH: `${join(root, 'scripts/macos-bin')}:${bin}:/usr/bin:/bin` }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'native:status')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test('macOS stop helper recognizes the modular upstream launcher', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bluff-stop-'))
  try {
    mkdirSync(join(fixture, 'scripts')); mkdirSync(join(fixture, '.local'))
    writeFileSync(join(fixture, '.local/app.pid'), '12345')
    // Shell-function stubs record the signal without touching a real process.
    writeFileSync(join(fixture, 'stubs.sh'), `ps() { printf '%s\\n' '${fixture}/scripts/dev/start.sh'; }\nkill() { printf 'signal:%s:%s\\n' "$1" "$2"; }\n`)
    copyFileSync(join(root, 'scripts/stop-local.sh'), join(fixture, 'scripts/stop-local.sh'))
    const copied = spawnSync('bash', [join(fixture, 'scripts/stop-local.sh')], {
      env: { ...process.env, BASH_ENV: join(fixture, 'stubs.sh') }, encoding: 'utf8',
    })
    assert.equal(copied.status, 0, copied.stderr)
    assert.match(copied.stdout, /signal:-TERM:12345/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
