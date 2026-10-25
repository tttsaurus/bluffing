import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import pg from 'pg'
import { databaseUrl } from '../../server/src/config.ts'

export function migrationChecksum(sql: string) {
  return createHash('sha256')
    .update(sql.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
    .digest('hex')
}
export async function migrationFiles() {
  const directory = fileURLToPath(
    new URL('../../database/migrations/', import.meta.url)
  )
  const files = (await readdir(directory))
    .filter((name) => /^V\d+__.*\.sql$/.test(name))
    .sort(
      (a, b) => Number(a.match(/^V(\d+)/)![1]) - Number(b.match(/^V(\d+)/)![1])
    )
  return Promise.all(
    files.map(async (name) => {
      const sql = (await readFile(resolve(directory, name), 'utf8'))
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
      return {
        name,
        version: Number(name.match(/^V(\d+)/)![1]),
        sql,
        checksum: migrationChecksum(sql),
      }
    })
  )
}
export async function migrate(connectionString = databaseUrl(true)) {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
  })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL search_path=public')
    await client.query("SET LOCAL lock_timeout='30s'")
    await client.query('SELECT pg_advisory_xact_lock(178642,10)')
    const files = await migrationFiles()
    if (files.some((file, index) => file.version !== index + 1))
      throw new Error(
        'Migration files must form an uninterrupted version history'
      )
    const existing = await client.query(
      "SELECT to_regclass('public.bluff_migrations') AS own,to_regclass('public.flyway_schema_history') AS legacy,to_regclass('public.players') AS players"
    )
    if (
      existing.rows[0].players &&
      !existing.rows[0].own &&
      !existing.rows[0].legacy
    )
      throw new Error(
        'Existing application tables have no recognized migration history; refusing to modify them'
      )
    await client.query(
      'CREATE TABLE IF NOT EXISTS bluff_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    )
    if (!existing.rows[0].own && existing.rows[0].legacy) {
      const legacy = await client.query(
        'SELECT version,script,success FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank'
      )
      for (const row of legacy.rows) {
        const file = files.find((file) => file.version === Number(row.version))
        if (
          !row.success ||
          !file ||
          file.version > 9 ||
          file.name !== row.script
        )
          throw new Error(
            'Unrecognized or failed Flyway migration; resolve it before migrating'
          )
        await client.query(
          'INSERT INTO bluff_migrations(version,name,checksum) VALUES($1,$2,$3)',
          [file.version, file.name, file.checksum]
        )
      }
    }
    const { rows: applied } = await client.query(
      'SELECT * FROM bluff_migrations ORDER BY version'
    )
    for (let i = 0; i < applied.length; i++) {
      const file = files[i],
        row = applied[i]
      if (
        !file ||
        row.version !== file.version ||
        row.name !== file.name ||
        row.checksum !== file.checksum
      )
        throw new Error(
          'Migration history or checksum mismatch; never edit an applied migration'
        )
    }
    for (const file of files.slice(applied.length)) {
      await client.query(file.sql)
      await client.query(
        'INSERT INTO bluff_migrations(version,name,checksum) VALUES($1,$2,$3)',
        [file.version, file.name, file.checksum]
      )
      console.log(`Applied ${file.name}`)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.slice(2).some((arg) => !['--help', '--plan'].includes(arg)))
    throw new Error('Unknown migration option; use --help or --plan')
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run db:migrate [-- --plan]. Uses DATABASE_URL_UNPOOLED, DIRECT_URL, or DATABASE_URL. Existing Flyway V1–V9 history is preserved.'
    )
  else if (process.argv.includes('--plan'))
    for (const file of await migrationFiles()) console.log(file.name)
  else await migrate()
}
