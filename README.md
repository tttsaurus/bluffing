# Bluff Table

Multiplayer Liar’s Deck, Plus, and 4 Fun. React + TypeScript + Vite frontend, TypeScript/Node backend, PostgreSQL. No Java or Gradle required.

## Requirements

Node.js 24 LTS and npm. Local hosting also needs PostgreSQL 16+ (native, Podman, or Docker). Linux is the primary platform; the same Node launcher works on macOS and Windows.

## Local database

Choose one container runtime:

```bash
podman run -d --name blufftable-db \
  -e POSTGRES_DB=blufftable \
  -e POSTGRES_USER=blufftable \
  -e POSTGRES_PASSWORD=blufftable \
  -p 127.0.0.1:5432:5432 \
  -v blufftable-data:/var/lib/postgresql/data \
  docker.io/library/postgres:16-alpine
```

Alternatively, use `docker compose up -d db`, or create a database on an existing PostgreSQL server:

```sql
CREATE USER blufftable WITH PASSWORD 'choose-a-password';
CREATE DATABASE blufftable OWNER blufftable;
```

Copy `.env.example` to `.env.local` and set `DATABASE_URL` if different from the local defaults. Keep credentials out of Git. Existing process environment variables take precedence over the env files.

Stop/start the container with `podman stop blufftable-db` / `podman start blufftable-db`. Its named volume preserves data.

## Install, build, and run

Run all commands from the repository root:

```bash
npm ci --include=optional
npm run dev
```

Open **http://localhost:5173**. Startup applies pending database migrations, waits for the backend on port **8080**, then starts Vite. Ctrl+C stops both servers without stopping PostgreSQL.

The existing entry point remains available:

```bash
bash scripts/start-dev.sh
```

To build and run without Vite:

```bash
npm run build
npm run db:migrate
npm start
```

Open **http://localhost:8080**. The Node backend serves both the built frontend and API/WebSocket endpoints. A normal build needs no database; migration and runtime do.

Optional settings: `PORT` (backend, default 8080), `BLUFF_STARTUP_TIMEOUT` (development startup, default 120 seconds). Development reserves port 5173 for Vite.

### macOS

Install Node.js 24 and PostgreSQL 16 with Homebrew, then use `npm run dev` with your database. To retain the managed project-local PostgreSQL setup:

```bash
brew install node@24 postgresql@16
npm ci --include=optional
bash scripts/start-local-macos.sh
```

This creates/reuses `.local/postgres` on port 5433. `bash scripts/stop-local.sh` stops the application; `bash scripts/stop-local-db.sh` stops this database without deleting it.

### Windows

Start PostgreSQL, set `DATABASE_URL` in `.env.local`, then run `npm ci --include=optional` and `npm run dev`. The PowerShell wrapper also works:

```powershell
./scripts/start-dev.ps1
```

### Root and two-tab debugging

Direct localhost access grants the server runner's device its persistent root identity. In the lobby, open two tabs at the **same address** and select **Switch to debug bot** in one tab. The other remains root. The persistent bot is a separate non-root player with independent room balances. Switching is tab-local, survives reloads, and is available only in the lobby.

Set `ALLOW_LOCAL_ROOT=false` to disable implicit root. Vercel always disables implicit root, regardless of request headers. Existing root accounts remain root when authenticated; no public visitor can claim root through the hosted endpoint. Do not publicly proxy a localhost deployment with root claiming enabled unless the proxy marks requests `X-Bluff-Proxied: true`.

## Tailscale

Connect Tailscale on the server, then:

```bash
npm run dev -- --tailnet
# Or: bash scripts/start-dev.sh --tailnet
```

On macOS: `bash scripts/start-local-macos.sh --tailnet`. On Windows: `./scripts/start-dev.ps1 -Tailnet`.

The launcher checks Tailscale connectivity before starting and configures private HTTPS Serve access to localhost:5173. Use the printed `.ts.net` address on allowed tailnet devices. Remote devices cannot claim local root.

If Serve permissions fail on Linux, configure your user as a Tailscale operator (`sudo tailscale set --operator=$USER`) and retry. To remove the exposure later: `tailscale serve reset`. The application remains loopback-bound.

## Vercel + Neon

1. Import this Git repository into Vercel. Use the **repository root**, not `frontend/`, as the Root Directory. The checked-in `vercel.json` builds the SPA and the TypeScript API together.
2. Add **Neon Postgres** from Vercel's Marketplace/Storage integration and connect it to this project.
3. Verify the deployment environment contains:
   - `DATABASE_URL`: Neon's **pooled** connection string for application traffic.
   - `DATABASE_URL_UNPOOLED`: the **direct** connection string for migrations. `DIRECT_URL` is also accepted.
4. Enable Neon's isolated database branches for Preview Deployments. **Do not point preview migrations at your production database.** Production and previews must receive their respective branch URLs.
5. Use Node.js **24**, enable **Fluid Compute**, and choose a function region near the Neon database.
6. Deploy. The configured build command, `npm run vercel-build`, applies migrations and builds the backend/frontend. Static assets are served from `frontend/dist`; `/api/*` and `/ws` go to the Node function.

Setup references: [Neon’s Vercel integration](https://neon.com/docs/guides/vercel-overview), [Vercel WebSockets](https://vercel.com/docs/functions/websockets).

Database credentials must be server environment variables, never `VITE_*` variables. No separate Java host, Redis service, or realtime provider is needed.

The backend uses Neon's pooled Postgres endpoint with a small, suspension-aware connection pool. Rooms, private hands, presence leases, payouts, and command deduplication are stored in PostgreSQL. WebSockets deliver viewer-specific snapshots; different function instances coordinate through database-backed room snapshots.

Vercel rotates long-lived connections. The client automatically reconnects without abandoning a live deal. Explicitly leaving still removes the player immediately; an offline connection expires after 45 seconds and cannot recover its removed hand. Games with one or fewer participants restore pre-game wallets. Spelling deadlines are persisted and settle on the next live refresh/request even after a cold start. No background cron is required.

### Migrating an existing database

Back up your existing PostgreSQL database first and stop the old backend. Set the new connection URL(s), then run `npm run db:migrate`. The runner recognizes the existing Flyway V1–V9 history; it preserves account IDs, device credentials, debug bots, rooms, wallets, ranks, skins and avatars.

An unfinished **old Java** game cannot be transferred because its hands were held only in Java memory: the one-time V10 migration cancels it and restores its pre-game wallets. Subsequent TypeScript games are durable and are not reset by deployment or restart.

Migrations are transactional, lock against simultaneous deployments, and reject changed applied migration files. Do not run the old Java server after applying V10.

Device credentials are stored per browser origin. Changing the public hostname does not automatically copy an existing device's local storage to the new domain; database records remain intact. Keep the same localhost address for local debugging and never publish device tokens.

### Optional local debugging against Neon

Use a **development Neon branch**, copy its pooled/direct URLs into `.env.local`, and run `npm run dev`. Local root and two-tab debugging work normally. Avoid debugging against production balances.

## Verification

```bash
npm run typecheck
npm test
npm run build
bash scripts/ci/check-scripts.sh
```

For real database/concurrency tests, explicitly select a disposable local PostgreSQL database named `blufftable_*qa`:

```bash
TEST_DATABASE_URL='postgresql://blufftable:password@127.0.0.1:5432/blufftable_testqa' npm run test:integration
```

This suite also creates/drops a disposable database to test the old Flyway upgrade; its local test role needs `CREATEDB`. Do not use a production or Neon branch for destructive tests.

For the full backend plus desktop/mobile browser suite:

```bash
npx playwright install chromium
TEST_DATABASE_URL='postgresql://blufftable:password@127.0.0.1:5432/blufftable_testqa' bash scripts/ci/integration.sh
```

## Clear application data

Stop all application instances first, then:

```bash
npm run db:clear -- --dry-run
npm run db:clear
```

The reset uses `DATABASE_URL_UNPOOLED` or `DATABASE_URL`, refuses active players and system databases, requires an interactive `CLEAR <database>` confirmation, and creates/verifies a `.backups/*.dump` backup with `pg_dump` / `pg_restore` before deletion. Schema and migration history are retained. Accounts, debug bots, rooms, balances, purchases and ranks are deleted; recover them by restoring that backup.

Use PostgreSQL client tools of the same or a newer major version than the database server for backups.
