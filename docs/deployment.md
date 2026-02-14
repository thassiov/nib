# Deployment

This guide covers deploying nib with Docker or bare metal.

## Docker (recommended)

The easiest way to run nib is with Docker Compose, which includes the app and a PostgreSQL database.

### Prerequisites

- Docker and Docker Compose

### Setup

```bash
git clone https://github.com/thassiov/nib.git
cd nib
```

Create a `.env` file:

```bash
SESSION_SECRET=<generate-with-openssl-rand-hex-32>
DB_PASS=<postgres-password>
OIDC_ISSUER=https://your-oidc-provider.example.com
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=<your-oidc-client-secret>
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
OIDC_POST_LOGOUT_URI=http://localhost:3000
```

Generate a session secret:

```bash
openssl rand -hex 32
```

### Run

```bash
docker compose up -d
```

The app will be available at `http://localhost:3000`. The PostgreSQL container runs migrations automatically via init scripts.

### What the compose file provides

- **nib app** — Node.js 22 Alpine container, built from the Dockerfile (multi-stage: build + production)
- **PostgreSQL 17** — Alpine container with a persistent volume (`pgdata`) and health checks
- **Migrations** — SQL files from `migrations/` are mounted as init scripts and run on first database creation
- **Session store** — The app auto-creates the `session` table in PostgreSQL on startup

### Environment variables

The compose file supports these env vars (set in `.env` or environment):

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | Yes | - | Express session secret |
| `DB_PASS` | Yes | - | PostgreSQL password (shared by app and db containers) |
| `OIDC_ISSUER` | No* | - | OIDC provider URL |
| `OIDC_CLIENT_ID` | No | `nib` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | No* | - | OIDC client secret |
| `OIDC_REDIRECT_URI` | No | `http://localhost:3000/auth/callback` | OIDC callback URL |
| `OIDC_POST_LOGOUT_URI` | No | `http://localhost:3000` | Post-logout redirect |
| `COOKIE_SECURE` | No | `false` | Set to `true` behind TLS proxy |
| `ADMIN_SUBS` | No | - | Comma-separated OIDC subject IDs for admin role |

*OIDC variables are only required if you want authentication. The app works without them — you just can't log in.

## Bare metal

### Prerequisites

- Node.js 22+
- PostgreSQL (external — nib does not include its own database server)

### Database setup

nib needs a PostgreSQL database to exist before it can start. The migration script creates **tables**, but the **database and user** must be created first.

If you already have a PostgreSQL server, create the database and user:

```sql
CREATE DATABASE nib;
CREATE USER nib WITH PASSWORD '<password>';
GRANT ALL PRIVILEGES ON DATABASE nib TO nib;
-- On PostgreSQL 15+, also grant schema permissions:
ALTER DATABASE nib OWNER TO nib;
```

Then create the tables using either method:

**Option A: Sequelize sync** (uses the model definitions directly):
```bash
DB_HOST=<your-pg-host> DB_USER=nib DB_PASS=<password> npx tsx server/migrate.ts
```

**Option B: SQL migration files** (the same ones Docker Compose uses):
```bash
psql -h <your-pg-host> -U nib -d nib -f migrations/001_initial.sql
psql -h <your-pg-host> -U nib -d nib -f migrations/002_add_user_role.sql
psql -h <your-pg-host> -U nib -d nib -f migrations/003_add_session_table.sql
```

The session table is also auto-created by `connect-pg-simple` on first startup (`createTableIfMissing: true`), so migration file `003` is optional if you prefer to let the app handle it.

On subsequent deploys, if models have changed:
```bash
DB_HOST=<your-pg-host> DB_USER=nib DB_PASS=<password> npx tsx server/migrate.ts --alter
```

The `--alter` flag adds new columns and indexes without dropping data.

### Build

```bash
git clone https://github.com/thassiov/nib.git
cd nib
npm ci
npm run build
```

This produces:
- `dist/client/` — Static frontend files (HTML, JS, CSS)
- `dist/server/` — Compiled server JavaScript

### Environment

Create a `.env` file or set environment variables:

```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-with-openssl-rand-hex-32>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nib
DB_USER=nib
DB_PASS=<database-password>

# OIDC (optional — app works without auth, you just can't log in)
OIDC_ISSUER=https://your-oidc-provider.example.com
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=<oidc-client-secret>
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
OIDC_POST_LOGOUT_URI=http://localhost:3000

# Optional
COOKIE_SECURE=false
ADMIN_SUBS=oidc-subject-id-1,oidc-subject-id-2
```

### Run

```bash
NODE_ENV=production node dist/server/main.js
```

In production mode, NestJS serves the built client files as static assets via `@nestjs/serve-static` and handles all routes (API, auth, and SPA fallback) on a single port.

## Health check

```bash
curl http://localhost:3000/api/health
```

Returns:
```json
{ "status": "ok", "service": "nib", "db": "connected", "oidc": "reachable" }
```

The health endpoint checks database connectivity via `Sequelize.authenticate()` and OIDC provider reachability. If the database is unreachable, it returns `"db": "disconnected"` but still responds with status `"ok"` (the server itself is running).

## Observability

nib exposes a Prometheus-compatible `/metrics` endpoint that can be scraped by any Prometheus-compatible collector (Prometheus, Grafana Alloy, Victoria Metrics, etc.).

### Prometheus scrape config

```yaml
scrape_configs:
  - job_name: nib
    static_configs:
      - targets: ['localhost:3000']
    scrape_interval: 15s
```

### Available metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `nib_drawings_total` | Gauge | `visibility` (public/private) | Total drawings in database |
| `nib_users_total` | Gauge | - | Total registered users |
| `nib_sessions_active` | Gauge | `type` (authenticated/anonymous) | Active sessions |
| `nib_drawings_created_total` | Counter | `visibility` (public/private) | Drawings created since restart |
| `nib_drawings_deleted_total` | Counter | - | Drawings deleted since restart |

Default Node.js process metrics (CPU, memory, event loop, GC) are also exposed via `prom-client`.

### Grafana dashboard

A pre-built Grafana dashboard is available with panels for application overview (drawings, users, sessions), activity timeseries (creation/deletion rates), process health (CPU, memory, event loop), and log aggregation (via Loki).

![Grafana dashboard](screenshots/grafana-dashboard.png)

### Notes

- The `/metrics` endpoint skips session middleware to prevent scrape requests from creating anonymous sessions.
- The endpoint is excluded from the SPA catch-all so it returns Prometheus text format, not the React app.
- Session counts use a raw SQL query (`sess::jsonb->>'userId'`) to classify sessions as authenticated or anonymous.
