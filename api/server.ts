import { createApplication } from '../server/src/http.ts'

// Vercel supports Node HTTP servers and ws upgrades on Fluid Compute. Runtime
// state is in Postgres; this singleton holds connections, never authoritative games.
export default createApplication().server
