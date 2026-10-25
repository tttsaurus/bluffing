import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { resolve, dirname } from 'node:path'
import { databaseUrl, port } from '../server/src/config.ts'
import { migrate } from './db/migrate.ts'
import { databaseStartupError } from './db/startup-error.ts'
import { checkTailnet, enableTailnet } from './network/tailscale.ts'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: npm run dev -- [--tailnet]\nStarts the TypeScript backend and Vite. Migrates PostgreSQL first. DATABASE_URL selects local PostgreSQL or Neon. Ctrl+C stops both servers.'
    )
    return
  }
  if (args.some((arg) => arg !== '--tailnet'))
    throw new Error('Unknown option; use --help')
  const backendPort = port(),
    timeout = Number(process.env.BLUFF_STARTUP_TIMEOUT ?? 120)
  if (
    backendPort === 5173 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 9999
  )
    throw new Error('Invalid PORT or BLUFF_STARTUP_TIMEOUT')
  async function portOpen(value: number) {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: value })
      socket.setTimeout(1000)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
    })
  }
  for (const value of [backendPort, 5173])
    if (await portOpen(value))
      throw new Error(
        `Port ${value} is already occupied; refusing to stop or reuse another server`
      )
  const require = createRequire(import.meta.url)
  const vite = resolve(
    dirname(require.resolve('vite/package.json')),
    'bin/vite.js'
  )
  const tailnet = args.includes('--tailnet')
  if (tailnet) await checkTailnet()
  console.log('Checking PostgreSQL and applying pending migrations…')
  const migrationUrl = databaseUrl(true)
  try {
    await migrate(migrationUrl)
  } catch (error) {
    throw databaseStartupError(error, migrationUrl)
  }
  const children: ChildProcess[] = []
  let stopping = false
  function start(arguments_: string[], env = process.env) {
    const child = spawn(process.execPath, arguments_, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit'
    })
    children.push(child)
    child.on('error', (error) => {
      console.error(error)
      void stop(1)
    })
    child.on('exit', (code) => {
      if (!stopping) {
        console.error(`A development server stopped (${code}).`)
        void stop(code || 1)
      }
    })
    return child
  }
  async function stop(code: number) {
    if (stopping) return
    stopping = true
    console.log('Stopping development servers…')
    for (const child of children) child.kill('SIGTERM')
    const force = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL')
      process.exit(code)
    }, 8000)
    force.unref()
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) =>
              child.once('exit', () => resolve())
            )
      )
    )
    clearTimeout(force)
    try {
      if (
        (await readFile('.local/app.pid', 'utf8')).trim() ===
        String(process.pid)
      )
        await unlink('.local/app.pid')
    } catch {}
    process.exit(code)
  }
  process.once('SIGINT', () => {
    void stop(130)
  })
  process.once('SIGTERM', () => {
    void stop(143)
  })
  const backend = `http://127.0.0.1:${backendPort}`
  start(['--import', 'tsx', 'server/src/local.ts'])
  async function wait(url: string) {
    const deadline = Date.now() + timeout * 1000
    while (!stopping && Date.now() < deadline) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok)
          return
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Timed out waiting for ${url}`)
  }
  try {
    await wait(`${backend}/api/health`)
    start(
      [vite, resolve('frontend'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      {
        ...process.env,
        BLUFF_BACKEND_URL: backend,
        VITE_LOCAL_API_URL: backend
      }
    )
    await wait('http://127.0.0.1:5173/')
    await mkdir('.local', { recursive: true })
    await writeFile('.local/app.pid', String(process.pid))
    if (tailnet) await enableTailnet()
    console.log(
      'Bluff Table is ready: http://localhost:5173/ — Ctrl+C stops both servers.'
    )
  } catch (error) {
    console.error(error)
    await stop(1)
  }
}
try {
  await main()
} catch (error) {
  console.error(
    `Startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
  )
  process.exitCode = 1
}
