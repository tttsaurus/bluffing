/** Show actionable connection errors without printing database credentials. */
export function databaseStartupError(
  error: unknown,
  connectionString: string
): Error {
  const codes = new Set<string>()
  function collect(value: unknown) {
    if (!value || typeof value !== 'object') return
    const entry = value as {
      code?: string
      cause?: unknown
      errors?: unknown[]
    }
    if (entry.code) codes.add(entry.code)
    if (entry.cause) collect(entry.cause)
    if (Array.isArray(entry.errors)) entry.errors.forEach(collect)
  }
  collect(error)
  const url = new URL(connectionString)
  const endpoint = `${url.hostname}:${url.port || '5432'}`
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const setup = local
    ? 'Start your existing database: podman start blufftable-db (or docker compose up -d db). For a first-time setup, see README.md → Local database. To use Neon instead, set DATABASE_URL and DATABASE_URL_UNPOOLED in .env.local.'
    : 'Check your network and database endpoint. For Neon, verify DATABASE_URL and DATABASE_URL_UNPOOLED in .env.local target the same branch.'
  if (codes.has('ECONNREFUSED'))
    return new Error(
      `PostgreSQL is not accepting connections at ${endpoint}.\n${setup}`
    )
  if (
    codes.has('ENOTFOUND') ||
    codes.has('EAI_AGAIN') ||
    codes.has('ETIMEDOUT')
  )
    return new Error(`Cannot reach PostgreSQL at ${endpoint}.\n${setup}`)
  if (codes.has('28P01') || codes.has('28000'))
    return new Error(
      `PostgreSQL authentication failed at ${endpoint}. Check the database username and password in .env.local.`
    )
  if (codes.has('3D000'))
    return new Error(
      `The configured PostgreSQL database does not exist at ${endpoint}. Create it using README.md → Local database, or correct the connection URL in .env.local.`
    )
  return error instanceof Error
    ? error
    : new Error('Database migration failed')
}
