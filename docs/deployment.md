# Deployment

This guide covers deploying nib to a homelab environment with PostgreSQL and Authelia.

## Prerequisites

- Node.js 20+
- PostgreSQL database
- Authelia instance with nib registered as an OIDC client (see [authentication.md](authentication.md))
- A reverse proxy (nginx, Caddy, Traefik) for TLS and routing

## Build

```bash
npm ci
npm run build
```

This produces:
- `dist/client/` — Static frontend files (HTML, JS, CSS)
- `dist/server/` — Compiled server JavaScript

## Database setup

Create the database and user:

```sql
CREATE DATABASE nib;
GRANT ALL PRIVILEGES ON DATABASE nib TO grid_admin;
```

Run migrations:

```bash
# First deploy: create tables
npx tsx server/migrate.ts

# Subsequent deploys: alter tables to match model changes
npx tsx server/migrate.ts --alter
```

The `--alter` flag adds new columns and indexes without dropping data. For breaking schema changes, you'd need a manual migration or `--force` (which drops and recreates — destructive).

## Environment

Create a `.env` file or set environment variables:

```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-a-strong-random-string>

# Database
DB_HOST=postgres.grid.local
DB_PORT=5432
DB_NAME=nib
DB_USER=grid_admin
DB_PASS=<database-password>

# OIDC
OIDC_ISSUER=https://authelia.grid.local
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=<oidc-client-secret>
OIDC_REDIRECT_URI=https://draw.grid.local/auth/callback
OIDC_POST_LOGOUT_URI=https://draw.grid.local
```

Generate a session secret:

```bash
openssl rand -hex 32
```

## Run

```bash
NODE_ENV=production node dist/server/index.js
```

In production mode, the Express server serves the built client files as static assets and handles all routes (API, auth, and SPA fallback) on a single port.

## Reverse proxy

nib should sit behind a reverse proxy that handles TLS termination. The app trusts `X-Forwarded-*` headers (`trust proxy` is enabled) for secure cookie handling.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name draw.grid.local;

    ssl_certificate     /etc/ssl/certs/grid.local.pem;
    ssl_certificate_key /etc/ssl/private/grid.local.key;

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

- `X-Forwarded-Proto` must be set for secure cookies to work. Express checks this header when `trust proxy` is enabled.
- `client_max_body_size` should match the Express JSON limit (50MB) to allow large drawings.
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
ExecStart=/usr/bin/node dist/server/index.js
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
{ "status": "ok", "service": "nib", "db": "connected" }
```

The health endpoint checks database connectivity. If the database is unreachable, it returns `"db": "disconnected"` but still responds with status `"ok"` (the server itself is running). This is intentional — nib starts even if the database isn't ready yet, and will connect on first request.

## Backups

nib stores all drawing data in PostgreSQL. Back up the `nib` database:

```bash
pg_dump -h postgres.grid.local -U grid_admin nib > nib_backup.sql
```

Key tables:
- `users` — User accounts (linked to OIDC identities)
- `scenes` — Drawings (JSONB data can be large)

There are no local files to back up. Session data is stored in server memory (lost on restart — users just re-authenticate).

## Upgrading

```bash
cd /opt/nib
git pull
npm ci
npm run build
npx tsx server/migrate.ts --alter
sudo systemctl restart nib
```
