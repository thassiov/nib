# Architecture

## System overview

nib is a full-stack application with a React SPA frontend and a NestJS API backend, both written in TypeScript. Users authenticate via OIDC (any provider — tested with Authelia), create drawings using Excalidraw, and store them in PostgreSQL.

```
                   ┌─────────────┐
                   │    OIDC     │
                   │  Provider   │
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
- Session middleware with PostgreSQL-backed store (`connect-pg-simple`) in production, in-memory fallback in development
- HTTP-only cookies (`nib.sid`, 30-day expiry, `sameSite: lax`)
- JSON body parsing (50MB limit for large drawings)
- Trust proxy (for reverse proxy setups)

### Module structure

```
AppModule
  ├── DatabaseModule      Sequelize connection (PostgreSQL)
  ├── UsersModule         User CRUD (service + repository)
  ├── AuthModule          OIDC login/logout, guards, scene adoption
  ├── ScenesModule        Scene CRUD, validation (controller + service + repository)
  └── ServeStaticModule   Client files in production (conditional)
```

`server/app.module.ts` is the root module. It imports all feature modules and conditionally adds `ServeStaticModule` in production for SPA serving.

### Database layer

`server/database/database.module.ts` configures `SequelizeModule.forRoot()` with PostgreSQL connection settings. Models use `sequelize-typescript` decorators (`@Table`, `@Column`, `@BelongsTo`, `@HasMany`).

**Models:**
- `UserModel` (`server/database/models/user.model.ts`) — OIDC identity. Keyed by `sub` (OIDC subject). Upserted on each login so profile data stays current. Has a `role` column (`admin` or `user`, default `user`).
- `SceneModel` (`server/database/models/scene.model.ts`) — An Excalidraw drawing. Belongs to a user (nullable for anonymous scenes). The `data` field stores the full Excalidraw scene JSON (JSONB in Postgres, JSON in SQLite for tests). The `thumbnail` field stores a base64-encoded PNG preview. Cascades on user deletion.

**Associations:**
- User `@HasMany` Scenes (with `onDelete: "CASCADE"`)
- Scene `@BelongsTo` User

The dialect-aware setup (JSONB vs JSON, partial indexes only on Postgres) allows the same models to run against both PostgreSQL in production and SQLite in-memory during tests.

### Session store

Sessions are stored in PostgreSQL via `connect-pg-simple`. The store connects using a `pg.Pool` with the same database credentials as the app. The session table is auto-created on startup (`createTableIfMissing: true`). When `DB_HOST` is not set (local dev without Docker), sessions fall back to the default in-memory store.

Session fields (augmented in `server/auth/session.d.ts`):
- `userId`, `sub`, `username`, `role` — authenticated user identity
- `idToken` — stored for OIDC logout hint
- `ownedScenes` — array of scene IDs created anonymously in this session
- `returnTo` — URL to redirect back to after OIDC login
- `code_verifier`, `oidc_state` — transient PKCE flow data

### Authentication

See [authentication.md](authentication.md) for the full auth flow.

The auth layer consists of:
- `server/auth/oidc.ts` — Stateless OIDC client using `openid-client` v6. Handles discovery, PKCE login URL generation, token exchange, and logout URL building.
- `server/auth/auth.service.ts` — Injectable NestJS service wrapping the OIDC functions.
- `server/auth/auth.controller.ts` — Controller handling `/auth/login`, `/auth/callback`, `/auth/logout`, and `/auth/me`. Implements scene adoption on login and `returnTo` redirect.
- `server/auth/guards/auth.guard.ts` — NestJS guard that requires an authenticated session (returns 403 if missing).
- `server/auth/guards/optional-auth.guard.ts` — Pass-through guard that always allows the request. Used as a documentation/intent marker on routes that accept both authenticated and anonymous access.
- `server/auth/guards/admin.guard.ts` — Guard that requires `session.role === "admin"`. Used for admin-only features like the remote logging toggle.
- `server/auth/session.d.ts` — TypeScript declaration augmenting `express-session` with nib's session fields.

### Users

- `server/users/users.service.ts` — Injectable service for user operations (upsert, findById, findBySub).
- `server/users/users.repository.ts` — Data access layer using `@InjectModel(UserModel)`.

User roles are determined at login time by checking if the user's OIDC `sub` appears in the `ADMIN_SUBS` environment variable (comma-separated list).

### Scenes

The scenes feature is the core of nib, with proper layered architecture:

- `server/scenes/scenes.controller.ts` — Thin controller with `@UseGuards` for auth. Handles HTTP concerns only (parsing query params, setting status codes). Uses `OptionalAuthGuard` on most routes to support both authenticated and anonymous access.
- `server/scenes/scenes.service.ts` — Business logic. Unified `list()` method with a `filter` parameter (`"public"` or `"mine"`) replaces old duplicated listing logic. Ownership enforcement on update/delete. Supports session-based anonymous ownership via `ownedScenes`.
- `server/scenes/scenes.repository.ts` — Data access with `@InjectModel(SceneModel)`. Unified `findAll()` with pagination, eager loading, and where-clause abstraction. Includes `adoptByIds()` for transferring anonymous scene ownership on login.
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
- `GET /auth/login` — Redirects to OIDC authorization endpoint. Accepts `?returnTo=/path` to redirect back after login.
- `GET /auth/callback` — Handles OIDC callback, upserts user, adopts anonymous scenes, sets session, redirects to `returnTo` or `/`.
- `GET /auth/logout` — Destroys session, redirects to OIDC end-session.
- `GET /auth/me` — Returns `{ id, sub, username, role }` or 401.

**Scene routes** (`/api/scenes/*`):
- `GET /api/scenes` — Public gallery, paginated.
- `GET /api/scenes/my` — User's own scenes (requires auth).
- `GET /api/scenes/:id` — Single scene with `canEdit` flag (respects visibility + ownership).
- `POST /api/scenes` — Create scene from JSON (auth optional; anonymous scenes tracked in session).
- `POST /api/scenes/upload` — Upload `.excalidraw`/`.json` file (auth optional).
- `POST /api/scenes/validate` — Validate scene data without saving.
- `PUT /api/scenes/:id` — Update scene (requires ownership — authenticated or session-based).
- `DELETE /api/scenes/:id` — Delete scene (requires auth + ownership).

**Other:**
- `GET /api/health` — Database connectivity check.
- `POST /api/log` — Client-side remote logging endpoint (receives log messages from the browser and writes them to container stdout).

Features:
- Pagination on list endpoints (default 20, max 100)
- Public gallery includes author info via Sequelize eager loading
- Ownership enforcement on update/delete (403 for non-owners)
- Private scenes return 404 to non-owners (no information leakage)
- Partial updates supported (any combination of title, data, is_public, thumbnail)
- `canEdit` flag returned with scene detail for the client to determine edit vs view-only mode

### Anonymous ownership

Anonymous users can create and edit drawings without an account. Ownership is tracked via `session.ownedScenes` — an array of scene IDs stored in the server-side session.

| | Authenticated | Anonymous |
|---|---|---|
| `user_id` | Session user | `null` |
| `is_public` default | `false` (private) | `true` (public) |
| Can edit | Owner check via `user_id` | Session check via `ownedScenes` |
| Session TTL | 30 days | 30 days |
| On login | N/A | Scenes adopted via `adoptByIds()` |
| On session expire | Still owns via `user_id` | Permanently read-only |

When an anonymous user logs in via OIDC, `auth.controller.ts` calls `scenesRepository.adoptByIds(session.ownedScenes, user.id)` to set `user_id` on all session-owned scenes, then clears `session.ownedScenes`.

### Dependency injection note

The project uses `"type": "module"` and `tsx` (which uses esbuild under the hood). esbuild does **not** support TypeScript's `emitDecoratorMetadata`, which NestJS normally relies on to infer constructor parameter types for DI. To work around this, all injectable constructors use explicit `@Inject()` decorators (e.g., `@Inject(ScenesService)`) instead of relying on metadata reflection. Classes using `@InjectModel()` from `@nestjs/sequelize` are unaffected since that decorator already provides an explicit injection token.

## Client

### React app structure

```
client/
  main.tsx                   Root render, imports Tailwind CSS
  index.css                  Tailwind v4 entry + shadcn/ui theme (oklch colors)
  App.tsx                    Router + AuthProvider + NavBar

  contexts/
    AuthContext.tsx           Auth state, useAuth() hook

  components/
    NavBar.tsx                Top navigation (ghost buttons, login/logout)
    ProtectedRoute.tsx        Auth gate for routes
    SceneCard.tsx             Drawing card (shadcn Card with thumbnail)
    NewDrawingButton.tsx      Create empty scene (shadcn Button + lucide Plus)
    UploadDrawingButton.tsx   File upload → scene (shadcn Button + lucide Upload)

  components/ui/
    button.tsx                shadcn Button (with ghost, outline, destructive variants)
    card.tsx                  shadcn Card
    badge.tsx                 shadcn Badge
    tooltip.tsx               shadcn Tooltip

  lib/
    utils.ts                  cn() utility (tailwind-merge + clsx)

  api/
    scenes.ts                 Scene API client (fetch wrappers)
    logger.ts                 Remote logging client (POST /api/log)

  pages/
    Gallery.tsx               Public gallery with paginated card grid
    MyDrawings.tsx            User's drawings with delete, visibility badges
    Editor.tsx                Excalidraw editor with toolbar, autosave, cloning

  __tests__/                  Client tests (jsdom)
```

### Styling

The client uses **Tailwind CSS v4** with the `@tailwindcss/vite` plugin (no PostCSS config or `tailwind.config.js`). The design system uses **shadcn/ui** components (new-york style) with oklch color variables for light and dark mode support.

`client/index.css` defines:
- Tailwind import and theme extension via `@theme inline`
- CSS custom properties for the shadcn color palette (light and dark)
- Base layer styles (full-height layout, `bg-background text-foreground`)
- Scoped `border-border` rule excluding `.excalidraw` internals to prevent Tailwind preflight conflicts

The `.dark` class on the root element toggles dark mode variables. A dark mode toggle is not yet wired in the UI.

### Auth context

`AuthContext` is the client-side auth state manager. On mount, it calls `GET /auth/me` to check if there's an active session. It exposes:

- `user` — Current user object (`{ id, sub, username, role }`) or `null`
- `loading` — `true` while the initial `/auth/me` check is in flight
- `login()` — Redirects to `/auth/login` (full page navigation to OIDC flow)
- `logout()` — Redirects to `/auth/logout`
- `refresh()` — Re-fetches `/auth/me`

### Routing

| Path | Component | Auth | Description |
|---|---|---|---|
| `/` | Gallery | Public | Public drawing gallery |
| `/gallery` | Gallery | Public | Alias for `/` |
| `/my` | MyDrawings | Required | User's own drawings |
| `/drawing/:id` | Editor | Public* | View/edit a drawing |

*`/drawing/:id` is publicly accessible for viewing. Editing is controlled by the `canEdit` flag from the API (true for owners and anonymous session creators).

`ProtectedRoute` wraps routes that require authentication. It shows a loading state while checking auth, then either renders the child component or redirects to `/`.

### NavBar

Always visible at the top. Shows:
- "nib" brand link (home)
- "Gallery" link (ghost button, always visible)
- "My Drawings" link (ghost button, only when logged in)
- "Logs ON/OFF" toggle (admin only, controls client-side remote logging)
- Username + "Log out" button (when logged in)
- "Log in" button (when not logged in)

### Editor

The editor wraps `@excalidraw/excalidraw` with:
- **Toolbar** showing title (click to rename), visibility badge (Public/Private), and save status
- **Autosave** on a 5-second interval, only fires when content is dirty (element reference comparison)
- **Thumbnail generation** via `exportToBlob()` on each save
- **Custom MainMenu** with Save, Make Public/Private, Make a Copy, Upload New Drawing, Export, gallery/drawings links, theme toggle, and login (for anonymous users)
- **Anonymous → login prompt** when clicking "Make Private" without an account
- **Flush on unmount** to save any pending changes when navigating away
- **View-only mode** for non-owners (enforced by `canEdit` flag from API)

### Client-side logging

`client/api/logger.ts` provides a `logger` object with `info()`, `warn()`, and `error()` methods. When enabled, log messages are sent to `POST /api/log` and written to container stdout by the server. The toggle is admin-only, controlled from the NavBar.

## Testing

Tests run with Vitest. Server tests use NestJS `Test.createTestingModule()` with SQLite in-memory databases. Client tests use jsdom (set per-file via `@vitest-environment jsdom`).

All test files run sequentially (`isolate: false` with `pool: "forks"`) because server tests share state within their respective test suites.

130 tests across 10 files:

| File | Tests | Coverage |
|---|---|---|
| `server/scenes/scenes.test.ts` | 60 | Scene CRUD, upload, adoption, ownership, validation |
| `server/services/validator.test.ts` | 26 | Excalidraw scene structural validation |
| `server/db.test.ts` | 13 | Models, associations, cascade delete, anonymous scenes |
| `client/__tests__/api-scenes.test.tsx` | 12 | Scene API client functions |
| `client/__tests__/AuthContext.test.tsx` | 6 | Client auth state management |
| `client/__tests__/NavBar.test.tsx` | 4 | Navigation rendering |
| `client/__tests__/ProtectedRoute.test.tsx` | 3 | Route guarding |
| `server/auth/guards/auth.guard.test.ts` | 3 | Auth guard |
| `server/auth/auth.controller.test.ts` | 2 | Login adoption |
| `server/app.controller.test.ts` | 1 | Health endpoint |

Test helpers in `server/__tests__/helpers.ts` provide:
- `createTestApp()` — NestJS test app with SQLite, session middleware, and all modules registered
- `createAuthenticatedTestApp({ userId })` — Same but with fake auth middleware injecting session data
- `VALID_SCENE` / `VALID_TEXT_SCENE` — Fixture scene data

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

nib is designed for a homelab environment that already runs an identity provider. Using OIDC means no password management, no user registration flow, and SSO across services. PKCE (Proof Key for Code Exchange) is the modern standard for public/server-side clients — it prevents authorization code interception without requiring client secrets in the browser.

### Why server-side sessions instead of JWTs

Sessions are simpler for this use case. The server needs to track user state anyway (OIDC tokens for logout, anonymous scene ownership), and sessions give us immediate revocation (logout destroys the session). JWTs would add complexity (token refresh, revocation lists) without benefits for a single-server deployment. Sessions are stored in PostgreSQL for persistence across server restarts.

### Why explicit @Inject() instead of emitDecoratorMetadata

The project uses `tsx` for development, which delegates to esbuild for TypeScript compilation. esbuild strips type information and does not emit the `Reflect.metadata` calls that NestJS uses to resolve constructor parameter types. Rather than switching to a slower TypeScript compiler or adding a build step for development, we use explicit `@Inject(ClassName)` decorators on all constructor parameters. This is a one-line addition per parameter and makes the DI resolution explicit and portable across any TypeScript compiler.

### Why Tailwind CSS v4 + shadcn/ui

Tailwind v4's CSS-first configuration (no `tailwind.config.js`) and Vite plugin integration keep the build simple. shadcn/ui provides accessible, well-designed components (Button, Card, Badge) that are copied into the project as source code — no runtime dependency, full control. The oklch color system gives perceptually uniform colors across light and dark themes.
