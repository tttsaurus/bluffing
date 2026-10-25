import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline/promises'
import pg from 'pg'
import { databaseUrl } from '../../server/src/config.ts'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Usage: npm run db:clear -- [--dry-run]\nUses DATABASE_URL_UNPOOLED (or DATABASE_URL). Requires pg_dump, pg_restore, no active players, a verified backup and typed CLEAR <database> confirmation. Schema and migration history are kept.'
    )
    return
  }
  if (args.some((arg) => arg !== '--dry-run'))
    throw new Error('Unknown option; use --help')
  const connectionString = databaseUrl(true),
    url = new URL(connectionString),
    name = decodeURIComponent(url.pathname.slice(1))
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
    ['postgres', 'template0', 'template1'].includes(name)
  )
    throw new Error('Refusing an unsafe/system database target')
  console.log(
    `Target: ${url.hostname}:${url.port || 5432}/${name}. Deletes accounts, rooms, wallets, purchases, rankings, and live sessions.`
  )
  if (args.includes('--dry-run')) {
    console.log('Dry run: no connection, backup or deletion.')
    return
  }
  if (!process.stdin.isTTY)
    throw new Error(
      'Interactive confirmation is required; database not cleared'
    )
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const schema = await client.query(
      "SELECT to_regclass('public.bluff_migrations') AS migrated,current_database() AS name"
    )
    if (!schema.rows[0].migrated || schema.rows[0].name !== name)
      throw new Error('Not a migrated Bluff Table database')
    if (
      Number(
        (
          await client.query(
            'SELECT count(*) AS n FROM live_sessions WHERE expires_at>clock_timestamp()'
          )
        ).rows[0].n
      ) > 0
    )
      throw new Error(
        'Active players exist. Stop all servers and wait 45 seconds before clearing'
      )
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const answer = await prompt.question(`Type CLEAR ${name} to confirm: `)
    prompt.close()
    if (answer !== `CLEAR ${name}`)
      throw new Error('Cancelled; database not cleared')
    await mkdir('.backups', { recursive: true })
    const backup = `.backups/${name}-${Date.now()}.dump`
    const dump = spawn(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges'],
      {
        env: { ...process.env, PGDATABASE: connectionString },
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    )
    const exited = new Promise<void>((resolve, reject) => {
      dump.on('error', reject)
      dump.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Database backup failed'))
      )
    })
    await Promise.all([
      pipeline(
        dump.stdout,
        createWriteStream(backup, { flags: 'wx', mode: 0o600 })
      ),
      exited,
    ])
    const verify = spawn('pg_restore', ['--list'], {
      stdio: ['pipe', 'ignore', 'inherit'],
    })
    const verified = new Promise<void>((resolve, reject) => {
      verify.on('error', reject)
      verify.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Backup verification failed'))
      )
    })
    await Promise.all([
      pipeline(createReadStream(backup), verify.stdin),
      verified,
    ])
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout='5s'")
    await client.query(
      'LOCK TABLE players,rooms,room_memberships,live_sessions,game_commands,member_avatars,member_skins,room_skins IN ACCESS EXCLUSIVE MODE'
    )
    const active = await client.query(
      'SELECT count(*) AS n FROM live_sessions WHERE expires_at>clock_timestamp()'
    )
    if (Number(active.rows[0].n) > 0)
      throw new Error(
        'Players connected during confirmation; database was not cleared'
      )
    // Explicit tables, no CASCADE: unexpected references cause rollback instead of data loss.
    await client.query(
      'TRUNCATE game_commands,live_sessions,member_avatars,member_skins,room_skins,room_memberships,rooms,players'
    )
    await client.query('COMMIT')
    console.log(
      `Cleared ${name}. Recoverable with pg_restore from ${backup}. Schema and migration history kept.`
    )
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}
await main()
