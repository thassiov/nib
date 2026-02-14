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
- PostgreSQL

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

### Database setup

Create the database and run migrations:

```sql
CREATE DATABASE nib;
CREATE USER nib WITH PASSWORD '<password>';
GRANT ALL PRIVILEGES ON DATABASE nib TO nib;
```

```bash
# Create tables
npx tsx server/migrate.ts

# Subsequent deploys: alter tables to match model changes
npx tsx server/migrate.ts --alter
```

The `--alter` flag adds new columns and indexes without dropping data. For breaking schema changes, you'd need a manual migration or `--force` (which drops and recreates — destructive).

The session table is auto-created by `connect-pg-simple` on first startup (`createTableIfMissing: true`), so no manual migration is needed for sessions.

### Environment

Create a `.env` file or set environment variables:

```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-a-strong-random-string>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nib
DB_USER=nib
DB_PASS=<database-password>

# OIDC
OIDC_ISSUER=https://your-oidc-provider.example.com
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=<oidc-client-secret>
OIDC_REDIRECT_URI=https://your-domain.example.com/auth/callback
OIDC_POST_LOGOUT_URI=https://your-domain.example.com

# Optional
COOKIE_SECURE=true
ADMIN_SUBS=oidc-subject-id-1,oidc-subject-id-2
```

### Run

```bash
NODE_ENV=production node dist/server/main.js
```

In production mode, NestJS serves the built client files as static assets via `@nestjs/serve-static` and handles all routes (API, auth, and SPA fallback) on a single port.

## Reverse proxy

nib should sit behind a reverse proxy that handles TLS termination. The app trusts `X-Forwarded-*` headers (`trust proxy` is enabled in `main.ts`) for secure cookie handling.

When behind a TLS-terminating proxy, set `COOKIE_SECURE=true` in your environment.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name draw.example.com;

    ssl_certificate     /etc/ssl/certs/draw.example.com.pem;
    ssl_certificate_key /etc/ssl/private/draw.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (if needed later)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Large drawing uploads
        client_max_body_size 50m;
    }
}
```

### Important proxy settings

- `X-Forwarded-Proto` must be set for secure cookies to work. NestJS checks this header when `trust proxy` is enabled.
- `client_max_body_size` should match the body parser limit (50MB) to allow large drawings.
- The proxy should forward the `Host` header so the OIDC callback URL resolves correctly.

## systemd service

```ini
[Unit]
Description=nib drawing platform
After=network.target postgresql.service

[Service]
Type=simple
User=nib
WorkingDirectory=/opt/nib
ExecStart=/usr/bin/node dist/server/main.js
EnvironmentFile=/opt/nib/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nib
```

## Health check

```bash
curl http://localhost:3000/api/health
```

Returns:
```json
{ "status": "ok", "service": "nib", "db": "connected", "oidc": "reachable" }
```

The health endpoint checks database connectivity via `Sequelize.authenticate()` and OIDC provider reachability. If the database is unreachable, it returns `"db": "disconnected"` but still responds with status `"ok"` (the server itself is running).

## Backups

nib stores all drawing data in PostgreSQL. Back up the `nib` database:

```bash
pg_dump -h localhost -U nib nib > nib_backup.sql
```

Key tables:
- `users` — User accounts (linked to OIDC identities)
- `scenes` — Drawings (JSONB data can be large)
- `session` — Server-side sessions (managed by `connect-pg-simple`)

## Upgrading

```bash
cd /opt/nib
git pull
npm ci
npm run build
npx tsx server/migrate.ts --alter
sudo systemctl restart nib
```

Or with Docker:

```bash
cd /path/to/nib
git pull
docker compose up -d --build
```
