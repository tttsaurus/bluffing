export function databaseUrl(migrations = false, env = process.env): string {
  const runtime = env.DATABASE_URL || env.POSTGRES_URL
  const direct = env.DATABASE_URL_UNPOOLED || env.DIRECT_URL
  const parse = (value: string) => {
    try {
      return new URL(value)
    } catch {
      throw new Error(
        'Invalid PostgreSQL connection URL; check your server environment variables'
      )
    }
  }
  if (!runtime && !direct && env.DB_URL)
    throw new Error(
      'DB_URL is a legacy JDBC setting; set DATABASE_URL to a PostgreSQL URL before starting'
    )
  if (migrations && runtime && direct) {
    const pooled = parse(runtime)
    const unpooled = parse(direct)
    if (
      pooled.hostname.endsWith('.neon.tech') &&
      unpooled.hostname.endsWith('.neon.tech') &&
      (pooled.hostname.replace(/-pooler(?=\.)/, '') !== unpooled.hostname ||
        pooled.pathname !== unpooled.pathname)
    )
      throw new Error(
        'Neon pooled and direct URLs must target the same branch and database'
      )
  }
  const url =
    (migrations ? env.DATABASE_URL_UNPOOLED || env.DIRECT_URL : undefined) ||
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    (!env.VERCEL
      ? 'postgresql://blufftable:blufftable@127.0.0.1:5432/blufftable'
      : '')
  if (!url || !/^postgres(ql)?:\/\//.test(url))
    throw new Error('Set DATABASE_URL to a PostgreSQL connection string')
  if (
    parse(url).protocol !== 'postgres:' &&
    parse(url).protocol !== 'postgresql:'
  )
    throw new Error('Invalid database URL')
  return url
}
export function port(value = process.env.PORT || '8080'): number {
  if (!/^\d+$/.test(value) || +value < 1 || +value > 65535)
    throw new Error('PORT must be between 1 and 65535')
  return +value
}
export const PRESENCE_TTL_MS = 45_000
export const ROOM_POLL_MS = 750
