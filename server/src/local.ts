import { createApplication } from './http.ts'
import { port } from './config.ts'

const app = createApplication(undefined, { staticFiles: true })
const serverPort = port()
await app.database.query('SELECT 1')
app.server.listen(serverPort, '127.0.0.1', () =>
  console.log(`Bluff Table TypeScript server: http://127.0.0.1:${serverPort}`)
)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await app.realtime.close()
  await new Promise<void>((resolve) => app.server.close(() => resolve()))
  await app.database.end()
}
process.once('SIGINT', () => {
  void stop().then(() => process.exit(0))
})
process.once('SIGTERM', () => {
  void stop().then(() => process.exit(0))
})
