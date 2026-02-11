# Architecture

## System overview

nib is a full-stack application with a React SPA frontend and a NestJS API backend, both written in TypeScript. Users authenticate via OIDC (Authelia), create drawings using Excalidraw, and store them in PostgreSQL.

```
                   ┌─────────────┐
                   │  Authelia    │
                   │  (OIDC)     │
                   └──────┬──────┘
                          │
┌──────────┐       ┌──────┴──────┐       ┌────────────┐
│  Browser │──────>│  NestJS     │──────>│  PostgreSQL │
│  (React) │<──────│  Server     │<──────│             │
└──────────┘       └─────────────┘       └────────────┘
     │
     │  Vite proxy (/api, /auth)
     │  in development
```

In development, Vite serves the React app on port 5173 and proxies API requests to NestJS on port 3000. In production, NestJS serves the built client as static files via `@nestjs/serve-static` and handles everything on a single port.

## Server

The server uses NestJS 11 with the Express platform adapter (`@nestjs/platform-express`). It follows a modular architecture with clean separation between controllers, services, and repositories.

### Entry point

`server/main.ts` bootstraps the NestJS application with:
- Session middleware (HTTP-only cookies, 7-day expiry, `nib.sid`)
- JSON body parsing (50MB limit for large drawings)
- Trust proxy (for reverse proxy setups)

### Module structure

```
AppModule
  ├── DatabaseModule      Sequelize connection (PostgreSQL)
  ├── UsersModule         User CRUD (service + repository)
  ├── AuthModule          OIDC login/logout, guards
  ├── ScenesModule        Scene CRUD, validation (controller + service + repository)
  └── ServeStaticModule   Client files in production (conditional)
```

`server/app.module.ts` is the root module. It imports all feature modules and conditionally adds `ServeStaticModule` in production for SPA serving.

### Database layer

`server/database/database.module.ts` configures `SequelizeModule.forRoot()` with PostgreSQL connection settings. Models use `sequelize-typescript` decorators (`@Table`, `@Column`, `@BelongsTo`, `@HasMany`).

**Models:**
- `UserModel` (`server/database/models/user.model.ts`) — OIDC identity. Keyed by `sub` (OIDC subject). Upserted on each login so profile data stays current.
- `SceneModel` (`server/database/models/scene.model.ts`) — An Excalidraw drawing. Belongs to a user. The `data` field stores the full Excalidraw scene JSON (JSONB in Postgres, JSON in SQLite for tests). Cascades on user deletion.

**Associations:**
- User `@HasMany` Scenes (with `onDelete: "CASCADE"`)
- Scene `@BelongsTo` User

The dialect-aware setup (JSONB vs JSON, partial indexes only on Postgres) allows the same models to run against both PostgreSQL in production and SQLite in-memory during tests.

### Authentication

See [authentication.md](authentication.md) for the full auth flow.

The auth layer consists of:
- `server/auth/oidc.ts` — Stateless OIDC client using `openid-client` v6. Handles discovery, PKCE login URL generation, token exchange, and logout URL building. Unchanged from the Express version.
- `server/auth/auth.service.ts` — Injectable NestJS service wrapping the OIDC functions.
- `server/auth/auth.controller.ts` — Controller handling `/auth/login`, `/auth/callback`, `/auth/logout`, and `/auth/me`.
- `server/auth/guards/auth.guard.ts` — NestJS guard replacing the old `requireAuth` middleware. Returns 403 if no session.
- `server/auth/guards/optional-auth.guard.ts` — Guard replacing `optionalAuth`. Always passes; session data is available if present.
- `server/auth/session.d.ts` — TypeScript declaration that augments `express-session` with nib's session fields (`userId`, `sub`, `username`, `idToken`).

### Users

- `server/users/users.service.ts` — Injectable service for user operations (upsert, findById, findBySub).
- `server/users/users.repository.ts` — Data access layer using `@InjectModel(UserModel)`.

### Scenes

The scenes feature is the core of nib, with proper layered architecture:

- `server/scenes/scenes.controller.ts` — Thin controller with `@UseGuards` for auth. Handles HTTP concerns only (parsing query params, setting status codes).
- `server/scenes/scenes.service.ts` — Business logic. Unified `list()` method with a `filter` parameter (`"public"` or `"mine"`) replaces the old duplicated listing logic. Ownership enforcement on update/delete.
- `server/scenes/scenes.repository.ts` — Data access with `@InjectModel(SceneModel)`. Unified `findAll()` with pagination, eager loading, and where-clause abstraction.
- `server/scenes/validator/scene-validator.service.ts` — Injectable wrapper around the structural Excalidraw validator.

**Scene validation** (`server/services/validator.ts`) performs structural validation of Excalidraw scene JSON. It exists because the `@excalidraw/excalidraw` package can't run in Node.js (it bundles React/DOM dependencies and uses browser-only ESM features).

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

**Auth routes** (`/auth/*`):
- `GET /auth/login` — Redirects to Authelia OIDC authorization endpoint
- `GET /auth/callback` — Handles OIDC callback, upserts user, sets session
- `GET /auth/logout` — Destroys session, redirects to Authelia end-session
- `GET /auth/me` — Returns current user info or 401

**Scene routes** (`/api/scenes/*`):
- `GET /api/scenes` — Public gallery, paginated
- `GET /api/scenes/my` — User's own scenes (requires auth)
- `GET /api/scenes/:id` — Single scene (respects visibility)
- `POST /api/scenes` — Create scene (requires auth)
- `POST /api/scenes/validate` — Validate scene data without saving
- `PUT /api/scenes/:id` — Update scene (requires auth + ownership)
- `DELETE /api/scenes/:id` — Delete scene (requires auth + ownership)

**Health** (`/api/health`) — Database connectivity check via `AppController`.

Features:
- Pagination on list endpoints (default 20, max 100)
- Public gallery includes author info via Sequelize eager loading
- Ownership enforcement on update/delete (403 for non-owners)
- Private scenes return 404 to non-owners (no information leakage)
- Partial updates supported (any combination of title, data, is_public, thumbnail)

### Dependency injection note

The project uses `"type": "module"` and `tsx` (which uses esbuild under the hood). esbuild does **not** support TypeScript's `emitDecoratorMetadata`, which NestJS normally relies on to infer constructor parameter types for DI. To work around this, all injectable constructors use explicit `@Inject()` decorators (e.g., `@Inject(ScenesService)`) instead of relying on metadata reflection. Classes using `@InjectModel()` from `@nestjs/sequelize` are unaffected since that decorator already provides an explicit injection token.

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

Tests run with Vitest. Server tests use NestJS `Test.createTestingModule()` with SQLite in-memory databases. Client tests use jsdom (set per-file via `@vitest-environment jsdom`).

All test files run sequentially (`isolate: false` with `pool: "forks"`) because server tests share state within their respective test suites.

Test helpers in `server/__tests__/helpers.ts` provide:
- `createTestApp()` — NestJS test app with SQLite, session middleware, and all modules registered
- `createAuthenticatedTestApp({ userId })` — Same but with fake auth middleware injecting session data
- `VALID_SCENE` / `VALID_TEXT_SCENE` — Fixture scene data

Model-level tests (`server/db.test.ts`) use a shared Sequelize instance from `server/__tests__/setup.ts` which creates an independent SQLite connection with models synced.

## Design decisions

### Why NestJS instead of Express

The original Express codebase had route handlers doing everything — HTTP parsing, business logic, and direct Sequelize queries. Scene listing was duplicated between the gallery and my-scenes endpoints. NestJS provides:
- Modular architecture with clear separation of concerns (controller/service/repository)
- Built-in dependency injection for testability
- Guards replacing ad-hoc middleware for auth
- A unified framework for growing the application

Express 5 is still the underlying HTTP platform via `@nestjs/platform-express`.

### Why structural validation instead of Excalidraw's `restore()`

The `@excalidraw/excalidraw` npm package bundles React, DOM APIs, and uses ESM-only features (extensionless imports via `roughjs`, JSON import attributes) that don't work in Node.js. We investigated jsdom shims, custom ESM loaders, and import map hacks — each fix revealed another layer of browser-only assumptions. The Excalidraw team confirms "doesn't support SSR." All known server-side approaches use Puppeteer (headless Chrome), which is overkill for validation.

The structural validator catches malformed data before it hits the database. The client will run Excalidraw's actual `restore()` for full fidelity on load.

### Why SQLite for tests

SQLite in-memory databases are fast, disposable, and don't require a running PostgreSQL instance. The Sequelize models use dialect-aware configuration (JSONB vs JSON, conditional partial indexes) so the same code runs against both. Each NestJS test app creates its own SQLite connection via `SequelizeModule.forRoot()`, giving full isolation.

### Why OIDC with PKCE instead of simple passwords

nib is designed for a homelab environment that already runs Authelia as a central identity provider. Using OIDC means no password management, no user registration flow, and SSO across services. PKCE (Proof Key for Code Exchange) is the modern standard for public/server-side clients — it prevents authorization code interception without requiring client secrets in the browser.

### Why server-side sessions instead of JWTs

Sessions are simpler for this use case. The server needs to track user state anyway (OIDC tokens for logout), and sessions give us immediate revocation (logout destroys the session). JWTs would add complexity (token refresh, revocation lists) without benefits for a single-server deployment.

### Why explicit @Inject() instead of emitDecoratorMetadata

The project uses `tsx` for development, which delegates to esbuild for TypeScript compilation. esbuild strips type information and does not emit the `Reflect.metadata` calls that NestJS uses to resolve constructor parameter types. Rather than switching to a slower TypeScript compiler or adding a build step for development, we use explicit `@Inject(ClassName)` decorators on all constructor parameters. This is a one-line addition per parameter and makes the DI resolution explicit and portable across any TypeScript compiler.
