# Development

## Getting started

```bash
git clone git@github.com:thassiov/nib.git
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

### Without Authelia

If you don't have an Authelia instance, the app still works — you just can't log in. The public gallery and scene viewing endpoints work without authentication. The health endpoint works too.

For testing authenticated flows without Authelia, you can use the test helpers (`createAuthenticatedTestApp()`) or hit the API directly with a session cookie from a test.

## Project structure

```
nib/
  client/                    React SPA (Vite)
    main.tsx                 Entry point
    App.tsx                  Router, AuthProvider, NavBar
    contexts/                React contexts
    components/              Shared components
    pages/                   Route pages
    __tests__/               Client tests (jsdom)

  server/                    NestJS API
    main.ts                  Bootstrap (session, body parser, trust proxy)
    app.module.ts            Root module (imports all feature modules)
    app.controller.ts        GET /api/health

    database/
      database.module.ts     SequelizeModule.forRoot() with PostgreSQL config
      models/
        user.model.ts        sequelize-typescript @Table/@Column decorators
        scene.model.ts       sequelize-typescript @Table/@Column decorators

    auth/
      auth.module.ts         Imports UsersModule, exports guards
      auth.controller.ts     /auth/login, callback, logout, me
      auth.service.ts        Injectable wrapper around oidc.ts
      oidc.ts                OIDC client (openid-client v6, PKCE)
      session.d.ts           Session type augmentation
      guards/
        auth.guard.ts        Requires authenticated session
        optional-auth.guard.ts  Allows anonymous access

    scenes/
      scenes.module.ts       Imports SceneModel, AuthModule
      scenes.controller.ts   Thin controller with @UseGuards
      scenes.service.ts      Business logic (unified list, CRUD, validation)
      scenes.repository.ts   Data access with pagination and eager loading
      validator/
        scene-validator.service.ts  Injectable wrapper around validator.ts
      dto/
        create-scene.dto.ts  class-validator decorators
        update-scene.dto.ts
        list-scenes-query.dto.ts

    users/
      users.module.ts        Imports UserModel, exports UsersService
      users.service.ts       User operations (upsert, find)
      users.repository.ts    Data access with @InjectModel

    services/
      validator.ts           Excalidraw scene structural validator
      validator.test.ts      Validator unit tests (26 tests)

    __tests__/
      setup.ts               Shared SQLite Sequelize for model-level tests
      helpers.ts             createTestApp(), createAuthenticatedTestApp(), fixtures

    migrate.ts               Database migration script (sequelize-typescript models)
    db.test.ts               Model/association tests (11 tests)

  docs/                      Documentation
  vitest.config.ts           Test configuration
  vite.config.ts             Client build configuration
  tsconfig.json              TypeScript configuration
  tsconfig.server.json       Server-only build configuration
  package.json               Dependencies and scripts
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

| File | Tests | What it covers |
|---|---|---|
| `server/services/validator.test.ts` | 26 | Excalidraw scene structural validation |
| `server/db.test.ts` | 13 | Model creation, associations, cascade delete, anonymous scenes |
| `server/scenes/scenes.test.ts` | 40 | Scene CRUD, file upload (authenticated + anonymous), validation |
| `server/auth/guards/auth.guard.test.ts` | 3 | Auth guard (authenticated, unauthenticated, public) |
| `client/__tests__/AuthContext.test.tsx` | 6 | Client-side auth state management |

### Server test setup

There are two test setups depending on the test level:

**Model tests** (`db.test.ts`): `server/__tests__/setup.ts` creates a shared Sequelize instance with SQLite in-memory, enables `PRAGMA foreign_keys`, and syncs all models. Tests import models directly.

**Integration tests** (`scenes.test.ts`, `auth.guard.test.ts`): `server/__tests__/helpers.ts` provides factory functions that create full NestJS test applications:

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

The server connects to PostgreSQL at `postgres.grid.local` by default. Override with environment variables:

```bash
DB_HOST=localhost DB_NAME=nib_dev DB_USER=postgres DB_PASS=postgres npm run dev:server
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

### Inspecting data

```bash
psql -h postgres.grid.local -U grid_admin nib

-- List users
SELECT id, sub, username, email FROM users;

-- List scenes with owner
SELECT s.id, s.title, s.is_public, u.username
FROM scenes s JOIN users u ON s.user_id = u.id
ORDER BY s.updated_at DESC;

-- Scene data size
SELECT id, title, pg_column_size(data) AS bytes FROM scenes ORDER BY bytes DESC;
```

## Code conventions

- **TypeScript strict mode** — No `any` unless absolutely necessary
- **ESM** — The project uses ES modules (`"type": "module"` in package.json). Imports use `.js` extensions for Node.js compatibility (TypeScript resolves `.ts` files from `.js` imports)
- **Explicit `@Inject()`** — All NestJS constructor parameters use `@Inject(ClassName)` because esbuild (used by tsx) doesn't support `emitDecoratorMetadata`. See the architecture doc for details.
- **Layered architecture** — Controllers handle HTTP, services handle business logic, repositories handle data access. No direct model queries in controllers.
- **Inline styles** — The client uses inline React styles (no CSS framework yet). This may change when the UI gets more complex.
- **Error responses** — All API errors return `{ error: "message" }`. Validation failures return `{ error: "message", validation: { valid, errors, elementCount } }`.
