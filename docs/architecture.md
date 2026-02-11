# Architecture

## System overview

nib is a full-stack application with a React SPA frontend and an Express API backend, both written in TypeScript. Users authenticate via OIDC (Authelia), create drawings using Excalidraw, and store them in PostgreSQL.

```
                   ┌─────────────┐
                   │  Authelia    │
                   │  (OIDC)     │
                   └──────┬──────┘
                          │
┌──────────┐       ┌──────┴──────┐       ┌────────────┐
│  Browser │──────>│  Express    │──────>│  PostgreSQL │
│  (React) │<──────│  Server     │<──────│             │
└──────────┘       └─────────────┘       └────────────┘
     │
     │  Vite proxy (/api, /auth)
     │  in development
```

In development, Vite serves the React app on port 5173 and proxies API requests to Express on port 3000. In production, Express serves the built client as static files and handles everything on a single port.

## Server

### Entry point

`server/index.ts` sets up Express with:
- Session middleware (HTTP-only cookies, 7-day expiry, `nib.sid`)
- JSON body parsing (50MB limit for large drawings)
- Auth routes (`/auth/*`)
- Scene API routes (`/api/scenes/*`)
- Health check (`/api/health`)
- Static file serving in production

### Database layer

`server/db.ts` defines the Sequelize models and provides `initDb()` for swapping the database in tests.

**Models:**
- `User` — OIDC identity. Keyed by `sub` (OIDC subject). Upserted on each login so profile data stays current.
- `Scene` — An Excalidraw drawing. Belongs to a user. The `data` field stores the full Excalidraw scene JSON (JSONB in Postgres, JSON in SQLite for tests). Cascades on user deletion.

**Associations:**
- User hasMany Scenes
- Scene belongsTo User

The dialect-aware setup (JSONB vs JSON, partial indexes only on Postgres) allows the same models to run against both PostgreSQL in production and SQLite in-memory during tests.

### Authentication

See [authentication.md](authentication.md) for the full auth flow.

The auth layer consists of three pieces:
- `server/auth/oidc.ts` — Stateless OIDC client using `openid-client` v6. Handles discovery, PKCE login URL generation, token exchange, and logout URL building.
- `server/auth/middleware.ts` — Two Express middlewares: `requireAuth` (returns 401) and `optionalAuth` (passes through, attaches session if present).
- `server/auth/session.d.ts` — TypeScript declaration that augments `express-session` with nib's session fields (`userId`, `sub`, `username`, `idToken`).

### Scene validation

`server/services/validator.ts` performs structural validation of Excalidraw scene JSON. It exists because the `@excalidraw/excalidraw` package can't run in Node.js (it bundles React/DOM dependencies and uses browser-only ESM features).

The validator checks:
- Top-level structure (`elements` array, optional `appState` object, optional `files` map)
- Element required fields (`id`, `type`, `x`, `y`, `width`, `height`)
- Element type validity (rectangle, text, arrow, etc.)
- Type-specific requirements (text elements need `text` + `fontSize`, arrows need `points`, images need `fileId`)
- Optional field formats (strokeStyle, fillStyle, roundness, angle)
- File entry structure (must have `mimeType` and `dataURL`)
- Size limits (50MB)

Validation runs on create and update. The standalone `POST /api/scenes/validate` endpoint allows validation without saving.

### Routes

`server/routes/auth.ts` — Login, callback, logout, and `/auth/me` (current user check).

`server/routes/scenes.ts` — Full CRUD with:
- Pagination on list endpoints (default 20, max 100)
- Public gallery includes author info via Sequelize eager loading
- Ownership enforcement on update/delete (403 for non-owners)
- Private scenes return 404 to non-owners (no information leakage)
- Partial updates supported (any combination of title, data, is_public, thumbnail)

## Client

### React app structure

```
client/
  main.tsx                 Root render
  App.tsx                  Router + AuthProvider + NavBar
  contexts/
    AuthContext.tsx         Auth state, useAuth() hook
  components/
    NavBar.tsx              Top navigation bar
    ProtectedRoute.tsx      Auth gate for routes
  pages/
    Gallery.tsx             Public gallery (placeholder)
    MyDrawings.tsx          User's drawings (placeholder)
    Editor.tsx              Drawing editor (placeholder)
```

### Auth context

`AuthContext` is the client-side auth state manager. On mount, it calls `GET /auth/me` to check if there's an active session. It exposes:

- `user` — Current user object (`{ id, sub, username }`) or `null`
- `loading` — `true` while the initial `/auth/me` check is in flight
- `login()` — Redirects to `/auth/login` (full page navigation to OIDC flow)
- `logout()` — Redirects to `/auth/logout`
- `refresh()` — Re-fetches `/auth/me` (for use after actions that might change auth state)

### Routing

| Path | Component | Auth | Description |
|---|---|---|---|
| `/` | Gallery | Public | Public drawing gallery |
| `/gallery` | Gallery | Public | Alias for `/` |
| `/my` | MyDrawings | Required | User's own drawings |
| `/drawing/new` | Editor | Required | Create new drawing |
| `/drawing/:id` | Editor | Public* | View/edit a drawing |

*`/drawing/:id` is publicly accessible for viewing shared drawings, but editing requires ownership (enforced by the API).

`ProtectedRoute` wraps routes that require authentication. It shows a loading state while checking auth, then either renders the child component or redirects to `/`.

### NavBar

Always visible. Shows:
- "nib" brand link (home)
- "Gallery" link (always)
- "My Drawings" link (only when logged in)
- Username + "Log out" button (when logged in)
- "Log in" button (when not logged in)

## Testing

Tests run with Vitest. Server tests use SQLite in-memory (swapped via `initDb()` in the setup file). Client tests use jsdom (set per-file via `@vitest-environment jsdom`).

All test files run sequentially (`isolate: false` with `pool: "forks"`) because server tests share the in-memory database.

Test helpers in `server/__tests__/helpers.ts` provide:
- `createApp()` — Fresh Express app with session + routes (no auth)
- `createAuthenticatedApp({ userId })` — Same but with a fake auth middleware injecting session data
- `VALID_SCENE` / `VALID_TEXT_SCENE` — Fixture scene data

## Design decisions

### Why structural validation instead of Excalidraw's `restore()`

The `@excalidraw/excalidraw` npm package bundles React, DOM APIs, and uses ESM-only features (extensionless imports via `roughjs`, JSON import attributes) that don't work in Node.js. We investigated jsdom shims, custom ESM loaders, and import map hacks — each fix revealed another layer of browser-only assumptions. The Excalidraw team confirms "doesn't support SSR." All known server-side approaches use Puppeteer (headless Chrome), which is overkill for validation.

The structural validator catches malformed data before it hits the database. The client will run Excalidraw's actual `restore()` for full fidelity on load.

### Why SQLite for tests

SQLite in-memory databases are fast, disposable, and don't require a running PostgreSQL instance. The Sequelize models use dialect-aware configuration (JSONB vs JSON, conditional partial indexes) so the same code runs against both. The `initDb()` function in `db.ts` allows tests to swap the database connection without touching application code.

### Why OIDC with PKCE instead of simple passwords

nib is designed for a homelab environment that already runs Authelia as a central identity provider. Using OIDC means no password management, no user registration flow, and SSO across services. PKCE (Proof Key for Code Exchange) is the modern standard for public/server-side clients — it prevents authorization code interception without requiring client secrets in the browser.

### Why server-side sessions instead of JWTs

Sessions are simpler for this use case. The server needs to track user state anyway (OIDC tokens for logout), and sessions give us immediate revocation (logout destroys the session). JWTs would add complexity (token refresh, revocation lists) without benefits for a single-server deployment.
