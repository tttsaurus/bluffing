import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export async function tailscale(
  args: string[],
  capture = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tailscale', args, {
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
      timeout: args[0] === 'serve' ? 30000 : 10000,
    })
    let text = ''
    child.stdout?.on('data', (chunk) => {
      text += chunk
      if (text.length > 128 * 1024) child.kill()
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve(text)
        : reject(
            new Error(
              `Tailscale exited with ${code}; check that it is connected and Serve is permitted`
            )
          )
    )
  })
}
export async function checkTailnet() {
  const status = JSON.parse(await tailscale(['status', '--json'], true))
  if (status.BackendState !== 'Running')
    throw new Error('Connect Tailscale before starting with --tailnet')
}
export async function enableTailnet() {
  const response = await fetch('http://127.0.0.1:5173/', {
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok)
    throw new Error('Start the frontend on 127.0.0.1:5173 first')
  await tailscale(['serve', '--bg', '--yes', 'http://127.0.0.1:5173'])
  await tailscale(['serve', 'status'])
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2)
  if (args.includes('--help'))
    console.log(
      'Usage: npm run tailnet -- [--check]. Connect Tailscale first; Serve exposes localhost:5173 privately to your tailnet.'
    )
  else {
    if (args.some((arg) => arg !== '--check')) throw new Error('Unknown option')
    await checkTailnet()
    if (!args.includes('--check')) await enableTailnet()
  }
}
