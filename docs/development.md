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
npm run dev:server   # Express on :3000 (tsx watch)
npm run dev:client   # Vite on :5173 (proxies /api and /auth to :3000)
```

The Vite dev server proxies `/api` and `/auth` requests to the Express server, so the client and server behave as a single origin during development.

### Without Authelia

If you don't have an Authelia instance, the app still works — you just can't log in. The public gallery and scene viewing endpoints work without authentication. The health endpoint works too.

For testing authenticated flows without Authelia, you can use the test helpers (`fakeAuth()`) or hit the API directly with a session cookie from a test.

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

  server/                    Express API
    index.ts                 App setup and start
    db.ts                    Sequelize models and initDb()
    migrate.ts               Database migration script
    auth/
      oidc.ts                OIDC client (openid-client v6)
      middleware.ts          requireAuth, optionalAuth
      session.d.ts           Session type augmentation
    routes/
      auth.ts                Login, callback, logout, me
      scenes.ts              Scene CRUD
    services/
      validator.ts           Excalidraw scene validator
    __tests__/
      setup.ts               Test setup (SQLite swap)
      helpers.ts             App factory, fakeAuth, fixtures

  docs/                      Documentation
  vitest.config.ts           Test configuration
  vite.config.ts             Client build configuration
  tsconfig.json              TypeScript configuration
  package.json               Dependencies and scripts
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start server + client in parallel (hot reload) |
| `npm run dev:server` | Start Express with `tsx watch` |
| `npm run dev:client` | Start Vite dev server |
| `npm run build` | Build client (Vite) and server (tsc) |
| `npm start` | Run production server |
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

All test files run sequentially in a single fork (`isolate: false`) because server tests share the SQLite in-memory database.

### Server test setup

`server/__tests__/setup.ts` runs before all tests. It:
1. Calls `initDb()` to swap Sequelize from PostgreSQL to SQLite in-memory
2. Runs `sequelize.sync({ force: true })` to create tables

This means server tests don't need PostgreSQL — they run entirely in memory.

### Test helpers

`server/__tests__/helpers.ts` provides:

```typescript
// Express app without auth (for public endpoint tests)
const app = createApp();

// Express app with fake auth session injected
const app = createAuthenticatedApp({ userId: "user-123" });

// Middleware that injects session data
app.use(fakeAuth({ userId: "user-123", sub: "sub", username: "alice" }));

// Fixture data
VALID_SCENE    // { elements: [rectangle], appState: {}, files: {} }
VALID_TEXT_SCENE  // { elements: [text element], ... }
```

### Client test setup

Client tests use `@vitest-environment jsdom` (set per-file via the docblock comment). They mock `fetch` with `vi.spyOn(globalThis, "fetch")` to test auth context behavior without a real server.

### Writing tests

**Server route tests:**
```typescript
import { createApp, createAuthenticatedApp, VALID_SCENE } from "../__tests__/helpers.js";

it("creates scene with valid data", async () => {
  const app = createAuthenticatedApp({ userId });
  const res = await request(app).post("/api/scenes").send({ data: VALID_SCENE });
  expect(res.status).toBe(201);
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
- **No ORMs in tests** — Test files import models directly, not through an abstraction layer
- **Inline styles** — The client uses inline React styles (no CSS framework yet). This may change when the UI gets more complex.
- **Error responses** — All API errors return `{ error: "message" }`. Validation failures return `{ error: "message", validation: { valid, errors, elementCount } }`.
