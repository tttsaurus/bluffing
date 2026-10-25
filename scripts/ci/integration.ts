import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { migrate } from '../db/migrate.ts'

const url = process.env.TEST_DATABASE_URL
if (
  !url ||
  !/^blufftable_[a-zA-Z0-9_]*qa$/.test(new URL(url).pathname.slice(1))
)
  throw new Error(
    'TEST_DATABASE_URL must explicitly select a disposable blufftable_*qa database'
  )
const occupied = await new Promise<boolean>((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port: 8181 })
  socket.once('connect', () => {
    socket.destroy()
    resolve(true)
  })
  socket.once('error', () => resolve(false))
})
if (occupied)
  throw new Error(
    'Port 8181 is occupied; refusing to reuse or stop an existing backend'
  )
await migrate(url)
await mkdir('server/reports', { recursive: true })
const log = await open('server/reports/integration-backend.log', 'w')
const backend = spawn(process.execPath, ['server/dist/local.js'], {
  env: { ...process.env, DATABASE_URL: url, PORT: '8181' },
  stdio: ['ignore', log.fd, log.fd],
})
async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Test process exited with ${code}`))
    )
  })
}
async function stop() {
  if (backend.exitCode !== null) return
  backend.kill('SIGTERM')
  const force = setTimeout(() => backend.kill('SIGKILL'), 8000)
  await new Promise<void>((resolve) => backend.once('exit', () => resolve()))
  clearTimeout(force)
}
process.once('SIGINT', () => {
  void stop().then(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void stop().then(() => process.exit(143))
})
try {
  let ready = false
  for (let n = 0; n < 120; n++) {
    if (backend.exitCode !== null)
      throw new Error(
        'Backend exited before it became healthy; see server/reports/integration-backend.log'
      )
    try {
      if (
        (
          await fetch('http://127.0.0.1:8181/api/health', {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('Backend startup timed out')
  await run(['--import', 'tsx', 'server/tests/integration.test.ts'])
  if (process.env.QA_SKIP_BROWSER !== 'true') {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    await new Promise<void>((resolve, reject) => {
      const child = spawn(npm, ['run', 'test:e2e', '--workspace', 'frontend'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Browser tests failed'))
      )
    })
  }
} finally {
  await stop()
  await log.close()
}
