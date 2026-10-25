import { createHash, randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type pg from 'pg'
import type { Player } from '../../shared/contracts.ts'
import { transaction } from './db.ts'
import { AppError, invariant } from './errors.ts'

export interface Account {
  id: string
  display_name: string
  device_token_hash: string
  root_account: boolean
  debug_owner_id: string | null
}
export function tokenHash(token: string) {
  invariant(
    typeof token === 'string' && token.length >= 32 && token.length <= 200,
    'This device identity is not recognized',
    401
  )
  return createHash('sha256').update(token).digest('hex')
}
export function playerView(account: Account): Player {
  return {
    id: account.id,
    displayName: account.display_name,
    root: account.root_account,
    identityTag: account.id.replaceAll('-', '').slice(0, 5),
  }
}
const loopbacks = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  '::ffff:127.0.0.1',
])
export function isLocalRoot(
  remoteAddress: string | undefined,
  headers: IncomingHttpHeaders,
  env = process.env
): boolean {
  if (
    env.VERCEL ||
    env.ALLOW_LOCAL_ROOT === 'false' ||
    !remoteAddress ||
    !loopbacks.has(remoteAddress) ||
    headers['x-bluff-proxied'] === 'true' ||
    headers['x-bluff-root-claim'] !== 'local-server-runner'
  )
    return false
  try {
    return (
      typeof headers.origin === 'string' &&
      loopbacks.has(new URL(headers.origin).hostname) &&
      typeof headers.host === 'string' &&
      loopbacks.has(new URL(`http://${headers.host}`).hostname)
    )
  } catch {
    return false
  }
}
export class Identities {
  constructor(private database: pg.Pool) {}
  async authenticate(token: string): Promise<Account> {
    const result = await this.database.query<Account>(
      'SELECT * FROM players WHERE device_token_hash=$1',
      [tokenHash(token)]
    )
    if (!result.rows[0])
      throw new AppError(401, 'This device identity is not recognized')
    return result.rows[0]
  }
  async authorization(header: string | undefined) {
    invariant(
      typeof header === 'string' && header.startsWith('Bearer '),
      'Authenticate this device first',
      401
    )
    return this.authenticate(header.slice(7))
  }
  async restore(
    displayName: string,
    token: string,
    grantRoot = false,
    legacyPlayerId?: string | null
  ) {
    const hash = tokenHash(token)
    return transaction(this.database, async (db) => {
      // A unique token constraint plus ON CONFLICT makes simultaneous first-tab registration safe.
      if (legacyPlayerId)
        await db.query(
          'UPDATE players SET device_token_hash=$1 WHERE id=$2 AND device_token_hash IS NULL',
          [hash, legacyPlayerId]
        )
      const { rows } = await db.query<Account>(
        `INSERT INTO players(id,display_name,device_token_hash,created_at) VALUES($1,$2,$3,now())
        ON CONFLICT(device_token_hash) WHERE device_token_hash IS NOT NULL DO UPDATE SET device_token_hash=EXCLUDED.device_token_hash RETURNING *`,
        [randomUUID(), displayName.trim(), hash]
      )
      const account = rows[0]
      if (
        grantRoot &&
        account.debug_owner_id == null &&
        !account.root_account
      ) {
        await db.query('UPDATE players SET root_account=true WHERE id=$1', [
          account.id,
        ])
        account.root_account = true
      }
      return playerView(account)
    })
  }
  async rename(account: Account, name: string) {
    const { rows } = await this.database.query<Account>(
      'UPDATE players SET display_name=$2 WHERE id=$1 RETURNING *',
      [account.id, name.trim()]
    )
    return playerView(rows[0])
  }
  async debug(account: Account) {
    invariant(
      account.root_account && !account.debug_owner_id,
      'Only root can use a debug identity',
      403
    )
    return transaction(this.database, async (db) => {
      await db.query('SELECT id FROM players WHERE id=$1 FOR UPDATE', [
        account.id,
      ])
      // Retain the Java backend's derivation, preserving all existing debug identities.
      const deviceToken = tokenHash(
        `debug-identity-v1:${account.device_token_hash}`
      )
      const hash = tokenHash(deviceToken)
      const { rows } = await db.query<Account>(
        `INSERT INTO players(id,display_name,device_token_hash,root_account,debug_owner_id,created_at)
        VALUES($1,'Debug bot',$2,false,$3,now()) ON CONFLICT(debug_owner_id) DO UPDATE SET debug_owner_id=EXCLUDED.debug_owner_id RETURNING *`,
        [randomUUID(), hash, account.id]
      )
      return { player: playerView(rows[0]), deviceToken }
    })
  }
}
