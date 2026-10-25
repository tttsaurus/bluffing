# Bluff Table

A multiplayer card-game framework with Liar's Deck, Liar's Deck Plus, and Liar's Deck 4 Fun.

## How it works

The project has three parts:

- **Web app:** React, TypeScript, Vite, CSS/Motion, and Zustand. It displays the lobby, waiting room, shop, and game table.
- **Game server:** TypeScript on Node.js. HTTP handles accounts and rooms; WebSockets carry moves and live updates. The server validates moves and calculates rewards.
- **Database:** PostgreSQL stores accounts, rooms, wallets, purchases, game state, and presence. Use local PostgreSQL for self-hosting, or Neon for hosted PostgreSQL.

A room has one game type, chosen when it is created. Each deal has its own deck count, hand size, and randomized seat order. Room wallets, purchases, and records persist between deals.

Each game type has its own engine class. Plus and 4 Fun inherit classic dealing, turns, checks, folds, and payouts, then add only their special rules. All three reuse the classic shop catalog and the same frontend setup/table components. State and ownership stay separate for every room and player.

Your browser stores a persistent account credential. Nicknames can overlap; the short identity hash distinguishes accounts. Clearing browser storage or changing browser/origin does not automatically recover that credential.

There are two ways to host the same application:

- **Your computer:** Node runs the backend and PostgreSQL runs separately. During development, Vite serves the web app at **http://localhost:5173** and proxies API/WebSocket traffic to the backend on port **8080**. A built app uses just **http://localhost:8080**.
- **Vercel + Neon:** Vercel serves the web app and Node backend; Neon stores the database. Database-backed game state lets different backend instances serve the same room.

Tailscale is optional: it lets other allowed devices reach the app running on your computer. It does not replace the server or database.

## Run locally and develop

Use **Node.js 24 with npm** and **PostgreSQL 16+**. No Java or Gradle is needed. Linux is the primary platform; all platforms use the same Node launcher.

Run commands from the repository folder containing `package.json`. Choose your OS below.

[Linux](#linux--podman) · [macOS](#macos--homebrew) · [Windows](#windows--powershell--docker-desktop) · [Tailscale](#tailscale-integration--share-your-local-server-privately) · [Vercel + Neon](#vercel-integration--deploy-with-neon-postgresql)

### Linux — Podman

Install Node.js 24 and Podman using your preferred package manager.

**First run:** create the database container once, then install dependencies and start the app:

```bash
podman run -d --name blufftable-db \
  -e POSTGRES_DB=blufftable \
  -e POSTGRES_USER=blufftable \
  -e POSTGRES_PASSWORD=blufftable \
  -p 127.0.0.1:5432:5432 \
  -v blufftable-data:/var/lib/postgresql/data \
  docker.io/library/postgres:16-alpine

npm ci --include=optional
npm run dev
```

**Later runs:**

```bash
podman start blufftable-db
npm run dev
```

Open **http://localhost:5173**. Edit files in `frontend/src/` or `server/src/`; restart the launcher after backend changes. The database volume preserves your data.

Ctrl+C stops the app. To stop PostgreSQL too, run `podman stop blufftable-db`.

Prefer Docker? Use `docker compose up -d db` instead of the Podman commands, then run the same npm commands. Use only one database on port 5432.

### macOS — Homebrew

Install [Homebrew](https://brew.sh/) first.

**First run:**

```bash
brew install node@24 postgresql@16
export PATH="$(brew --prefix)/opt/node@24/bin:$PATH"
npm ci --include=optional
bash scripts/macos/start.sh
```

**Later runs:**

```bash
bash scripts/macos/start.sh
```

Open **http://localhost:5173**. This helper creates/reuses a project-local database in `.local/postgres` on port **5433**, selects it for both runtime and migrations, and starts the normal dev launcher. It does not require a system PostgreSQL service or Docker.

Ctrl+C stops the app. To stop this database without deleting data:

```bash
bash scripts/macos/stop-db.sh
```

Do not delete `.local/postgres` to fix startup problems; it contains your database. If you already manage PostgreSQL yourself, use the alternative configuration below and run `npm run dev` instead.

### Windows — PowerShell + Docker Desktop

Install Node.js 24 and Docker Desktop. Start Docker Desktop with Linux containers enabled.

**First run, in PowerShell:**

```powershell
docker compose up -d db
npm ci --include=optional
npm run dev
```

**Later runs:**

```powershell
docker compose up -d db
npm run dev
```

Open **http://localhost:5173**. Ctrl+C stops the app; `docker compose stop db` stops PostgreSQL without deleting its volume.

The optional Windows launcher is `./scripts/start-dev.ps1`; it calls the same npm command. Docker is not mandatory: an existing native PostgreSQL installation works with the configuration below.

### Local database (existing PostgreSQL)

Skip container creation and the managed macOS helper if you already have PostgreSQL. Create an application role/database through your database administrator or SQL client, for example:

```sql
CREATE USER blufftable WITH PASSWORD 'choose-a-password';
CREATE DATABASE blufftable OWNER blufftable;
```

Create `.env.local` in the repository root by copying `.env.example` (`cp .env.example .env.local` in Bash, or `Copy-Item .env.example .env.local` in PowerShell). Set the URL to match your database:

```dotenv
DATABASE_URL=postgresql://blufftable:your-password@127.0.0.1:5432/blufftable
```

Then run `npm ci --include=optional` once and `npm run dev`.

Default container credentials are for local development only. Keep connection strings out of Git. Shell environment variables override env files; `.env.local` overrides `.env`. The managed macOS helper deliberately overrides database URLs to use its own port-5433 database.

### What startup does

The launcher applies pending migrations, starts the backend, waits for it to become healthy, and starts Vite from `frontend/`. **It does not start PostgreSQL**; only the managed macOS helper does that.

- `ECONNREFUSED` / “PostgreSQL is not accepting connections”: start your database and check the configured port.
- Missing `.env` / `.env.local` notices: harmless when using the default Linux/Windows container configuration.
- Port already occupied: stop the previous launcher with Ctrl+C; the script will not kill unrelated processes.
- After pulling dependency changes, rerun `npm ci --include=optional`.

Backend port: `PORT` (default 8080). Vite uses 5173. Both can stay loopback-only; remote access is covered in the Tailscale section.

### Root account and two-tab debugging

Open the app directly through localhost to claim a persistent local root account. In the lobby, open a second tab at the **same address**, then select **Switch to debug bot** in one tab. One tab remains root; the other becomes a persistent non-root player with its own room wallet. Switching is tab-local, survives reloads, and is only available in the lobby.

Use the same hostname and port consistently: `localhost`, `127.0.0.1`, a Tailscale address, and a Vercel address are different browser origins.

Set `ALLOW_LOCAL_ROOT=false` to disable implicit root. Do not publicly proxy a local deployment with implicit root enabled unless the proxy marks requests `X-Bluff-Proxied: true`. Hosted Vercel requests cannot claim root, even with forged localhost headers.

### Run a built app without Vite

Start your database, configure `.env.local` if needed, then:

```bash
npm run build
npm run db:migrate
npm start
```

Open **http://localhost:8080**. The Node backend now serves the built frontend, API, and WebSockets together. Building alone needs no database; migrations and runtime do.

For the managed macOS database, set `DATABASE_URL` in `.env.local` to its port-5433 URL before using these commands outside the helper. Keep it running, and ensure any direct migration URL targets the same database.

## Tailscale integration — share your local server privately

Tailscale Serve gives allowed tailnet devices an HTTPS address for the app on your computer. Your computer and PostgreSQL must remain running; this is not a Vercel deployment. The integration exposes the frontend on port 5173, not PostgreSQL. See [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) for HTTPS and access setup.

1. Install and connect Tailscale on the host and joining devices. Ensure the host's CLI works and your tailnet permits Serve/HTTPS.
2. Start PostgreSQL using your OS instructions.
3. Start the app with Tailscale enabled:

**Linux, or macOS/Windows with an already-running database:**

```bash
npm run dev -- --tailnet
```

**Managed macOS database:**

```bash
bash scripts/macos/start.sh --tailnet
```

**Windows PowerShell shortcut:**

```powershell
./scripts/start-dev.ps1 -Tailnet
```

Open the printed `.ts.net` HTTPS address on joining devices. The host can keep using localhost for root/debug-bot access; remote visitors cannot claim local root.

If the app is already running, use `npm run tailnet` to enable Serve or `npm run tailnet -- --check` to check connectivity only. If Serve permissions fail on Linux, grant your user operator access with `sudo tailscale set --operator=$USER`, then retry.

To clear this device's Serve configuration, run `tailscale serve reset`. Ctrl+C stops the app but does not reset Serve or stop PostgreSQL.

## Vercel integration — deploy with Neon PostgreSQL

Vercel hosts the frontend and Node backend; Neon supplies PostgreSQL. You do not need to keep your computer running or install PostgreSQL locally for deployment.

### Set up the project

1. Import the Git repository into Vercel. Use the **repository root**, not `frontend/`, as the Root Directory.
2. Add **Neon Postgres** through the Vercel Marketplace/Storage integration and connect the database to the project. See [Neon's Vercel integration](https://neon.com/docs/guides/vercel-overview).
3. Verify the server environment variables for each deployment environment:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled URL for normal application traffic. |
   | `DATABASE_URL_UNPOOLED` | Neon direct URL for migrations. `DIRECT_URL` is also accepted. |

4. Give preview deployments isolated Neon branches. **Never point preview migrations at the production database.** Pooled and direct URLs must target the same branch/database.
5. Select Node.js **24**, enable **Fluid Compute**, and choose a function region near Neon. WebSocket hosting requires Fluid Compute; see [Vercel's WebSocket documentation](https://vercel.com/docs/functions/websockets).
6. Deploy. The checked-in `vercel.json` installs dependencies, runs `npm run vercel-build` (migrations + build), serves `frontend/dist`, and routes `/api/*` and `/ws` to the Node backend. No separate frontend/backend deployment is needed.

Connection strings belong in server environment variables, never `VITE_*` variables or committed files. Local `.env.local` files are not automatically uploaded to Vercel.

### What changes in hosted mode

Game state, presence leases, and payouts live in PostgreSQL, so backend instances do not need shared memory. The client reconnects when a function's WebSocket connection rotates. A disconnected player has a 45-second presence lease; once expired, their removed hand cannot be recovered. Explicitly leaving removes them immediately. Games with one or fewer participants restore pre-game wallets.

Spelling deadlines settle on the next live refresh/request, including after a cold start. No cron or separate realtime service is required by this implementation.

Implicit root claiming is disabled on Vercel. Existing authenticated root accounts retain their privileges, but localhost browser credentials do not automatically transfer to a new hostname. Never publish account/device tokens to move an identity.

To debug locally against Neon, use a **development branch**, put its pooled/direct URLs in `.env.local`, and run `npm run dev` rather than the managed macOS database helper. Local root and two-tab debugging still work. Do not debug against production balances.

## Commands and maintenance

### Checks

```bash
npm run typecheck
npm test
npm run test:scripts
npm run build
```

For database/browser testing, create a disposable local database named `blufftable_*qa` and use a test role with `CREATEDB`. Set `TEST_DATABASE_URL` in your shell, for example `export TEST_DATABASE_URL='postgresql://blufftable:your-password@127.0.0.1:5432/blufftable_testqa'` in Bash, or `$env:TEST_DATABASE_URL = 'postgresql://blufftable:your-password@127.0.0.1:5432/blufftable_testqa'` in PowerShell. Do not use a production database or Neon branch for destructive tests.

After setting that variable:

```bash
npm run build
npx playwright install chromium
npm run test:ci
```

This starts a test backend, runs database/concurrency and desktop/mobile browser tests, and stops the backend. CI also checks builds/tests on Linux, macOS, and Windows.

### Upgrade an existing Java-era database

Back up PostgreSQL and stop the old backend before running `npm run db:migrate`. The migration runner recognizes Flyway V1–V9 and preserves identities, debug bots, rooms, wallets, purchases, and records.

The one-time V10 migration cancels unfinished Java-era games and restores their pre-game wallets because those hands existed only in Java memory. Subsequent TypeScript games are database-backed. Do not run the old Java server after V10.

### Clear application data

Stop all application instances, wait for live presence to expire, and install PostgreSQL client tools compatible with your database version. Then:

```bash
npm run db:clear -- --dry-run
npm run db:clear
```

Clearing requires typed confirmation and a verified `.backups/*.dump` backup made with `pg_dump`/`pg_restore`. It deletes accounts, rooms, wallets, purchases, and records, but retains the schema/migration history. Restore the backup to recover deleted data.

### Script reference

Use npm commands on all platforms; shell/PowerShell wrappers are optional.

| Command / script | Purpose |
| --- | --- |
| `npm run dev` → `scripts/dev.ts` | Migrate, start backend + Vite, check readiness, and clean up on exit. |
| `scripts/start-dev.sh` / `scripts/start-dev.ps1` | Bash / PowerShell shortcuts to the common launcher. |
| `npm run build` / `npm start` | Build both workspaces / serve the built app. |
| `npm run vercel-build` | Migrate and build for Vercel. |
| `npm run db:migrate` → `scripts/db/migrate.ts` | Apply migrations; `-- --plan` lists them without connecting. |
| `npm run db:clear` → `scripts/db/clear.ts` | Back up and reset data; `-- --dry-run` previews only. |
| `scripts/db/startup-error.ts` | Internal connection-error hints. |
| `npm run tailnet` → `scripts/network/tailscale.ts` | Enable Serve; `-- --check` checks connectivity only. |
| `npm run typecheck` / `npm test` | Type checks / frontend and backend unit tests. |
| `npm run test:scripts` → `scripts/ci/check.ts` | Script syntax and safety checks; CI runs these on Linux. |
| `npm run test:integration` | Database/concurrency tests against `TEST_DATABASE_URL`. |
| `npm run test:browser` | Browser tests; requires a test backend on port 8181. |
| `npm run test:ci` → `scripts/ci/integration.ts` | Disposable-database integration + browser suite with backend cleanup. |
| `scripts/macos/start.sh` / `stop-db.sh` | Start managed macOS PostgreSQL + app / stop only that database. |
| `scripts/macos/env.sh`, `scripts/macos/bin/tailscale` | Internal Homebrew and bundled Tailscale helpers. |
| `scripts/tests/*.test.mjs` | Launcher, platform, toolchain, and database-safety regressions. |
| `scripts/vocabulary/fetch-metadata.py` | Offline vocabulary/audio attribution maintenance; not needed to run the app. |
