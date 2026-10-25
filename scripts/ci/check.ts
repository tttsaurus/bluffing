import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
process.chdir(root)
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
async function syntax(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name)
    if (item.isDirectory()) await syntax(path)
    else if (item.name.endsWith('.mjs'))
      run(process.execPath, ['--check', path])
    else if (
      process.platform !== 'win32' &&
      (item.name.endsWith('.sh') || item.name === 'tailscale')
    )
      run('bash', ['-n', path])
  }
}
await syntax(resolve('scripts'))
for (const name of (await readdir('scripts/tests')).sort())
  if (name.endsWith('.test.mjs'))
    run(process.execPath, [resolve('scripts/tests', name)])
