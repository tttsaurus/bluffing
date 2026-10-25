import pg from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { databaseUrl } from './config.ts'

export type DbClient = pg.PoolClient
export function createPool(connectionString = databaseUrl()) {
  const pool = new pg.Pool({
    connectionString,
    max: process.env.VERCEL ? 2 : 8,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10_000,
    // Do not send session GUCs as startup parameters to Neon's transaction pooler.
    query_timeout: 20_000,
  })
  pool.on('error', () =>
    console.error('A PostgreSQL connection was interrupted')
  )
  if (process.env.VERCEL) attachDatabasePool(pool)
  return pool
}
let instance: pg.Pool | undefined
export function pool() {
  return (instance ??= createPool())
}
export async function transaction<T>(
  database: pg.Pool,
  action: (client: DbClient) => Promise<T>
): Promise<T> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='10s'"
    )
    const value = await action(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
