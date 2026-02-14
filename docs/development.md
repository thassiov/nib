# Development

## Getting started

```bash
git clone https://github.com/thassiov/nib.git
cd nib
npm install
```

### Running locally

```bash
# Start both server and client with hot reload
npm run dev

# Or run them separately
npm run dev:server   # NestJS on :3000 (tsx watch)
npm run dev:client   # Vite on :5173 (proxies /api and /auth to :3000)
```

The Vite dev server proxies `/api` and `/auth` requests to the NestJS server, so the client and server behave as a single origin during development.

### Without an OIDC provider

If you don't have an OIDC provider, the app still works — you just can't log in. The public gallery, anonymous drawing creation, and scene viewing all work without authentication. The health endpoint works too.

For testing authenticated flows without a provider, you can use the test helpers (`createAuthenticatedTestApp()`) or hit the API directly with a session cookie from a test.

### With Docker (for database)

The simplest way to get a database running locally:

```bash
docker compose up -d postgres
```

Then run the app outside Docker:

```bash
DB_HOST=localhost DB_PASS=<your-db-pass> npm run dev
```

## Project structure

```
nib/
  client/                      React SPA (Vite + Tailwind v4 + shadcn/ui)
    main.tsx                   Entry point, imports Tailwind CSS
    index.css                  Tailwind v4 entry + shadcn/ui theme (oklch colors)
    App.tsx                    Router, AuthProvider, NavBar

    api/
      scenes.ts                Scene API client (fetch wrappers)
      logger.ts                Remote logging client (POST /api/log)

    contexts/
      AuthContext.tsx           Auth state, useAuth() hook

    components/
      NavBar.tsx                Top navigation (ghost buttons, login/logout)
      ProtectedRoute.tsx        Auth gate for routes
      SceneCard.tsx             Drawing card (shadcn Card with thumbnail)
      NewDrawingButton.tsx      Create scene (shadcn Button + lucide Plus)
      UploadDrawingButton.tsx   Upload scene (shadcn Button + lucide Upload)

    components/ui/
      button.tsx                shadcn Button
      card.tsx                  shadcn Card
      badge.tsx                 shadcn Badge
      tooltip.tsx               shadcn Tooltip

    lib/
      utils.ts                  cn() utility (tailwind-merge + clsx)

    pages/
      Gallery.tsx               Public gallery with paginated card grid
      MyDrawings.tsx            User's drawings with delete, visibility badges
      Editor.tsx                Excalidraw editor with toolbar, autosave, cloning

    __tests__/                  Client tests (jsdom)

  server/                      NestJS API
    main.ts                    Bootstrap (compression, session store, body parser, trust proxy)
    app.module.ts              Root module (imports all feature modules)
    app.controller.ts          GET /api/health, POST /api/log

    database/
      database.module.ts       SequelizeModule.forRoot() with PostgreSQL config
      models/
        user.model.ts          sequelize-typescript @Table/@Column decorators
        scene.model.ts         sequelize-typescript @Table/@Column decorators

    auth/
      auth.module.ts           Imports UsersModule, ScenesModule (forwardRef), exports guards
      auth.controller.ts       /auth/login, callback (with adoption), logout, me
      auth.service.ts          Injectable wrapper around oidc.ts
      oidc.ts                  OIDC client (openid-client v6, PKCE)
      session.d.ts             Session type augmentation (ownedScenes, returnTo, role, etc.)
      guards/
        auth.guard.ts          Requires authenticated session
        optional-auth.guard.ts Allows anonymous access (pass-through)
        admin.guard.ts         Requires admin role

    scenes/
      scenes.module.ts         Imports SceneModel, AuthModule (forwardRef)
      scenes.controller.ts     Thin controller with @UseGuards, OptionalAuthGuard on most routes
      scenes.service.ts        Business logic (unified list, CRUD, ownership, validation)
      scenes.repository.ts     Data access with pagination, eager loading, adoptByIds()
      validator/
        scene-validator.service.ts  Injectable wrapper around validator.ts
      dto/
        create-scene.dto.ts    class-validator decorators
        update-scene.dto.ts
        list-scenes-query.dto.ts

    users/
      users.module.ts          Imports UserModel, exports UsersService
      users.service.ts         User operations (upsert with role, find)
      users.repository.ts      Data access with @InjectModel

    metrics/
      metrics.module.ts        Prometheus metrics module
      metrics.service.ts       Gauges (drawings, users, sessions) + counters (created, deleted)
      metrics.controller.ts    GET /metrics endpoint
      metrics.test.ts          Metrics integration tests

    services/
      validator.ts             Excalidraw scene structural validator
      thumbnail.ts             Server-side thumbnail generation (Excalidraw → SVG → PNG via sharp)

    __tests__/
      setup.ts                 Shared SQLite Sequelize for model-level tests
      helpers.ts               createTestApp(), createAuthenticatedTestApp(), fixtures

    migrate.ts                 Database migration script (sequelize-typescript models)

  migrations/                  SQL migration files (run by Docker init scripts)
    001_initial.sql            Users and scenes tables
    002_add_user_role.sql      Role column on users
    003_add_session_table.sql  PostgreSQL session table

  docs/                        Documentation
  components.json              shadcn/ui CLI configuration
  vitest.config.ts             Test configuration (with @/ path alias)
  vite.config.ts               Client build configuration (Tailwind v4 plugin, @/ alias)
  tsconfig.json                TypeScript configuration
  tsconfig.server.json         Server-only build configuration
  package.json                 Dependencies and scripts
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server + client in parallel (hot reload) |
| `npm run dev:server` | Start NestJS with `tsx watch` |
| `npm run dev:client` | Start Vite dev server |
| `npm run build` | Build client (Vite) and server (tsc) |
| `npm start` | Run production server (`node dist/server/main.js`) |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run migrate` | Sync database schema |

## Testing

### Running tests

```bash
npm test            # Run once
npm run test:watch  # Watch mode
```

### Test architecture

Tests use **Vitest** with two environments:
- **Server tests** (`server/**/*.test.ts`) — Run in Node.js with SQLite in-memory
- **Client tests** (`client/**/*.test.tsx`) — Run in jsdom

All test files run sequentially in a single fork (`isolate: false`) because server tests share state within their test suites.

### Test suites

148 tests across 11 files:

| File | Tests | What it covers |
|---|---|---|
| `server/scenes/scenes.test.ts` | 71 | Scene CRUD, upload, incremental patch, adoption, anonymous ownership, validation |
| `server/services/validator.test.ts` | 26 | Excalidraw scene structural validation |
| `server/db.test.ts` | 13 | Model creation, associations, cascade delete, anonymous scenes |
| `client/__tests__/api-scenes.test.tsx` | 12 | Scene API client functions |
| `server/metrics/metrics.test.ts` | 7 | Prometheus gauges, counters, default process metrics |
| `client/__tests__/AuthContext.test.tsx` | 6 | Client-side auth state management |
| `client/__tests__/NavBar.test.tsx` | 4 | Navigation rendering (brand, links, login/logout) |
| `client/__tests__/ProtectedRoute.test.tsx` | 3 | Route guarding (loading, redirect, render) |
| `server/auth/guards/auth.guard.test.ts` | 3 | Auth guard (authenticated, unauthenticated, public) |
| `server/auth/auth.controller.test.ts` | 2 | Login with scene adoption |
| `server/app.controller.test.ts` | 1 | Health endpoint |

### Server test setup

There are two test setups depending on the test level:

**Model tests** (`db.test.ts`): `server/__tests__/setup.ts` creates a shared Sequelize instance with SQLite in-memory, enables `PRAGMA foreign_keys`, and syncs all models. Tests import models directly.

**Integration tests** (`scenes.test.ts`, `auth.guard.test.ts`, `auth.controller.test.ts`): `server/__tests__/helpers.ts` provides factory functions that create full NestJS test applications:

```typescript
// NestJS app without auth (for public endpoint tests)
const app = await createTestApp();

// NestJS app with fake auth session injected
const app = await createAuthenticatedTestApp({ userId: "user-123" });
```

Each test app gets its own SQLite in-memory database via `SequelizeModule.forRoot()`. The helpers also set up session middleware and sync tables. Tests use `supertest` against `app.getHttpServer()`.

### Fixture data

```typescript
import { VALID_SCENE, VALID_TEXT_SCENE } from "../__tests__/helpers.js";

VALID_SCENE      // { elements: [rectangle], appState: {}, files: {} }
VALID_TEXT_SCENE  // { elements: [text element], appState: {}, files: {} }
```

### Client test setup

Client tests use `@vitest-environment jsdom` (set per-file via the docblock comment). They mock `fetch` with `vi.spyOn(globalThis, "fetch")` to test auth context behavior without a real server.

The `vitest.config.ts` includes a `@` path alias pointing to `client/` so that shadcn/ui component imports (`@/lib/utils`, etc.) resolve correctly in the test environment.

### Writing tests

**Integration tests (scene API):**
```typescript
import request from "supertest";
import { createTestApp, createAuthenticatedTestApp, VALID_SCENE } from "../__tests__/helpers.js";

it("creates scene with valid data", async () => {
  const app = await createAuthenticatedTestApp({ userId });
  const res = await request(app.getHttpServer())
    .post("/api/scenes")
    .send({ data: VALID_SCENE });
  expect(res.status).toBe(201);
  await app.close();
});
```

**Client component tests:**
```typescript
/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";

it("shows user when authenticated", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "u1", sub: "s", username: "alice" }), { status: 200 }),
  );
  renderWithAuth();
  await waitFor(() => {
    expect(screen.getByTestId("user").textContent).toBe("alice");
  });
});
```

## Database

### Local development

The server connects to PostgreSQL using the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASS` environment variables. When `DB_HOST` is not set, sessions fall back to in-memory storage.

```bash
DB_HOST=localhost DB_NAME=nib DB_USER=nib DB_PASS=password npm run dev:server
```

### Migrations

```bash
# Create tables (safe, won't drop existing)
npx tsx server/migrate.ts

# Alter tables to match current models (adds columns/indexes)
npx tsx server/migrate.ts --alter

# Drop and recreate (DESTROYS DATA)
npx tsx server/migrate.ts --force
```

The session table is auto-created by `connect-pg-simple` and doesn't need manual migration.

### Inspecting data

```bash
psql -h localhost -U nib nib

-- List users
SELECT id, sub, username, email, role FROM users;

-- List scenes with owner
SELECT s.id, s.title, s.is_public, s.user_id, u.username
FROM scenes s LEFT JOIN users u ON s.user_id = u.id
ORDER BY s.updated_at DESC;

-- Anonymous scenes (no owner)
SELECT id, title, is_public FROM scenes WHERE user_id IS NULL;

-- Scene data size
SELECT id, title, pg_column_size(data) AS bytes FROM scenes ORDER BY bytes DESC;

-- Active sessions
SELECT sid, expire, sess->>'userId' AS user_id FROM session ORDER BY expire DESC;
```

## Code conventions

- **TypeScript strict mode** — No `any` unless absolutely necessary
- **ESM** — The project uses ES modules (`"type": "module"` in package.json). Imports use `.js` extensions for Node.js compatibility (TypeScript resolves `.ts` files from `.js` imports)
- **Explicit `@Inject()`** — All NestJS constructor parameters use `@Inject(ClassName)` because esbuild (used by tsx) doesn't support `emitDecoratorMetadata`. See the architecture doc for details.
- **Layered architecture** — Controllers handle HTTP, services handle business logic, repositories handle data access. No direct model queries in controllers.
- **Tailwind CSS v4 + shadcn/ui** — All styling uses Tailwind utility classes and shadcn/ui components. No inline styles. Theme colors use oklch CSS custom properties.
- **Error responses** — All API errors return `{ error: "message" }`. Validation failures return `{ error: "message", validation: { valid, errors, elementCount } }`.

## Adding shadcn/ui components

The project uses shadcn/ui with the `new-york` style. To add a new component:

```bash
npx shadcn@latest add <component-name>
```

Components are placed in `client/components/ui/` as configured in `components.json`. They use the `cn()` utility from `client/lib/utils.ts` for class merging.
