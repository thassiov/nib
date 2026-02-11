# nib

A drawing platform wrapping [Excalidraw](https://excalidraw.com/) with authentication, persistent storage, and galleries.

## Overview

nib lets you create, save, and share Excalidraw drawings behind an OIDC login. Drawings are stored in PostgreSQL and can be kept private or published to a public gallery.

### Current status

The server API and React client are fully functional and tested. The app has an Excalidraw editor with autosave, public gallery, personal drawings page, and file upload endpoint.

## Architecture

```
client/               React + Vite SPA
  contexts/           Auth state management
  components/         NavBar, ProtectedRoute, SceneCard
  pages/              Gallery, MyDrawings, Editor

server/               NestJS API
  auth/               OIDC integration (Authelia), guards
  scenes/             Scene CRUD (controller, service, repository)
  users/              User operations (service, repository)
  database/           Sequelize models (UserModel, SceneModel)
  services/           Excalidraw scene validator
  migrate.ts          Database migration script
```

**Stack:** TypeScript, React 18, Vite, NestJS 11, Express 5, Sequelize (sequelize-typescript), PostgreSQL, Authelia (OIDC), Vitest.

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL instance
- Authelia (or any OIDC provider)

### Install

```bash
git clone git@github.com:thassiov/nib.git
cd nib
npm install
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `SESSION_SECRET` | `nib-dev-secret-change-me` | Express session secret |
| `NODE_ENV` | - | Set to `production` for secure cookies and static file serving |
| `DB_HOST` | `postgres.grid.local` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `nib` | Database name |
| `DB_USER` | `grid_admin` | Database user |
| `DB_PASS` | - | Database password |
| `OIDC_ISSUER` | `https://authelia.grid.local` | OIDC provider URL |
| `OIDC_CLIENT_ID` | `nib` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | - | OIDC client secret |
| `OIDC_REDIRECT_URI` | `http://draw.grid.local/auth/callback` | OIDC callback URL |
| `OIDC_POST_LOGOUT_URI` | `http://draw.grid.local` | Post-logout redirect URL |

### Database

Create the database and run migrations:

```bash
createdb nib

# Safe sync (creates missing tables)
npx tsx server/migrate.ts

# Or alter existing tables to match models
npx tsx server/migrate.ts --alter

# Or drop and recreate (DESTRUCTIVE)
npx tsx server/migrate.ts --force
```

### Run

```bash
# Development (server + client with hot reload)
npm run dev

# Server only
npm run dev:server

# Client only
npm run dev:client

# Production build
npm run build
npm start
```

In development, the Vite dev server runs on port 5173 and proxies `/api` and `/auth` requests to the NestJS server on port 3000.

## API Reference

### Health

```
GET /api/health
```

Returns `{ status: "ok", service: "nib", db: "connected" | "disconnected" }`.

### Authentication

Authentication uses OIDC with PKCE. The server manages sessions via HTTP-only cookies (7-day expiry).

```
GET /auth/login      -> Redirects to OIDC provider
GET /auth/callback   -> Handles OIDC callback, creates/updates user, sets session
GET /auth/logout     -> Destroys session, redirects to OIDC end-session endpoint
GET /auth/me         -> Returns current user or 401
```

`GET /auth/me` response (authenticated):
```json
{
  "id": "uuid",
  "sub": "oidc-subject",
  "username": "alice"
}
```

### Scenes

#### List public scenes (gallery)

```
GET /api/scenes?page=1&limit=20
```

No auth required. Returns public scenes sorted by last update, with author info.

```json
{
  "scenes": [
    {
      "id": "uuid",
      "title": "My Drawing",
      "thumbnail": null,
      "is_public": true,
      "created_at": "...",
      "updated_at": "...",
      "user": { "id": "uuid", "username": "alice", "avatar_url": null }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 }
}
```

#### List my scenes

```
GET /api/scenes/my?page=1&limit=20
```

Requires auth. Returns the authenticated user's scenes (public and private).

#### Get a scene

```
GET /api/scenes/:id
```

Public scenes are accessible to anyone. Private scenes return 404 to non-owners.

Returns full scene data including the Excalidraw JSON in the `data` field.

#### Create a scene

```
POST /api/scenes
Content-Type: application/json

{
  "title": "My Drawing",
  "data": { "elements": [...], "appState": {...}, "files": {...} },
  "is_public": false
}
```

Requires auth. The `data` field is validated against the Excalidraw scene schema. Title defaults to "Untitled", `is_public` defaults to `false`.

Returns `201` with the created scene, or `422` with validation errors.

#### Update a scene

```
PUT /api/scenes/:id
Content-Type: application/json

{
  "title": "New Title",
  "data": { ... },
  "is_public": true,
  "thumbnail": "data:image/png;base64,..."
}
```

Requires auth + ownership. All fields are optional (partial updates). If `data` is provided, it's validated. Returns `403` if not the owner.

#### Delete a scene

```
DELETE /api/scenes/:id
```

Requires auth + ownership. Returns `204` on success, `403` if not the owner.

#### Validate a scene (standalone)

```
POST /api/scenes/validate
Content-Type: application/json

{ "elements": [...], "appState": {...} }
```

No auth required. Validates Excalidraw scene JSON without persisting it. Returns detailed errors.

```json
{
  "valid": false,
  "elementCount": 3,
  "errors": [
    { "path": "$.elements[2].type", "message": "Unknown element type 'foo'" }
  ]
}
```

Validated properties include element types, required fields (`id`, `type`, `x`, `y`, `width`, `height`), stroke/fill styles, roundness, and type-specific fields (text content, arrow points, image file references). Size limit: 50MB.

#### Upload a scene file

```
POST /api/scenes/upload
Content-Type: multipart/form-data

file:      <.excalidraw or .json file>  (required)
title:     "My Drawing"                 (optional, defaults to filename)
is_public: "true" | "false"             (optional, see defaults below)
```

**Auth is optional.** This endpoint is designed for CLI and script usage where OIDC session cookies are impractical.

| | Authenticated | Anonymous |
|---|---|---|
| `user_id` | Session user | `null` |
| `is_public` default | `false` (private) | `true` (public) |

The file is parsed as JSON and validated through the same pipeline as `POST /api/scenes`. Returns `201` with the created scene, `400` for missing file or invalid JSON, `422` for invalid scene data.

**Examples:**

```bash
# Anonymous upload (public by default, no auth needed)
curl -X POST https://draw.grid.local/api/scenes/upload \
  -F "file=@my-drawing.excalidraw"

# Anonymous upload with explicit title
curl -X POST https://draw.grid.local/api/scenes/upload \
  -F "file=@sketch.excalidraw" \
  -F "title=Architecture Diagram"

# Authenticated upload (private by default)
curl -X POST https://draw.grid.local/api/scenes/upload \
  -F "file=@drawing.excalidraw" \
  --cookie "nib.sid=<session-cookie>"

# Authenticated upload, made public
curl -X POST https://draw.grid.local/api/scenes/upload \
  -F "file=@drawing.excalidraw" \
  -F "is_public=true" \
  --cookie "nib.sid=<session-cookie>"
```

Anonymous scenes have no owner — they appear in the public gallery but cannot be edited or deleted via the API. File size limit: 50MB. Accepted extensions: `.excalidraw`, `.json`.

## Data model

### User

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Auto-generated |
| `sub` | TEXT | OIDC subject (unique) |
| `username` | TEXT | Display name from OIDC |
| `email` | TEXT | Nullable |
| `avatar_url` | TEXT | Nullable |
| `created_at` | TIMESTAMP | Auto-set |

Users are upserted on each login (username/email/avatar updated from OIDC claims).

### Scene

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Auto-generated |
| `user_id` | UUID | FK to users (nullable), CASCADE delete |
| `title` | TEXT | Defaults to "Untitled" |
| `data` | JSONB | Excalidraw scene JSON |
| `thumbnail` | TEXT | Base64 preview (optional) |
| `is_public` | BOOLEAN | Defaults to `false` |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-set |

When `user_id` is `null`, the scene is anonymous — created via the upload endpoint without authentication.

## Client

The React client provides a full drawing experience:

- **`/`**, **`/gallery`** — Public gallery with paginated scene cards.
- **`/my`** — Protected. User's own drawings with delete functionality.
- **`/drawing/new`** — Protected. New Excalidraw editor with manual first save.
- **`/drawing/:id`** — Excalidraw editor with autosave (3s debounce). Read-only for non-owners.

The `NavBar` shows navigation links, the current username, and login/logout. The `AuthProvider` context fetches `/auth/me` on mount and exposes `{ user, loading, login(), logout(), refresh() }` via the `useAuth()` hook.

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests use Vitest with SQLite in-memory for server tests and jsdom for client tests. 88 tests across 5 files:

- `server/services/validator.test.ts` — 26 tests for scene validation
- `server/db.test.ts` — 13 tests for models, associations, and anonymous scenes
- `server/auth/guards/auth.guard.test.ts` — 3 tests for auth guard
- `server/scenes/scenes.test.ts` — 40 tests for scene CRUD, upload (authenticated + anonymous), and validation
- `client/__tests__/AuthContext.test.tsx` — 6 tests for React auth context

## License

Private.
