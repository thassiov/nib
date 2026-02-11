# Authentication

nib uses OpenID Connect (OIDC) with PKCE for authentication, delegating identity management to Authelia (or any OIDC-compliant provider).

## How it works

### Login flow

```
Browser                     nib Server                  Authelia
  │                            │                           │
  │  GET /auth/login           │                           │
  │ ──────────────────────>    │                           │
  │                            │  Generate PKCE verifier   │
  │                            │  + state, store in session│
  │                            │                           │
  │  302 Redirect              │                           │
  │ <──────────────────────    │                           │
  │                            │                           │
  │  GET /authorize?code_challenge=...&state=...           │
  │ ──────────────────────────────────────────────────>    │
  │                            │                           │
  │  User logs in at Authelia  │                           │
  │ <──────────────────────────────────────────────────    │
  │                            │                           │
  │  GET /auth/callback?code=...&state=...                 │
  │ ──────────────────────>    │                           │
  │                            │  Exchange code + verifier │
  │                            │ ─────────────────────>    │
  │                            │  Tokens + user info       │
  │                            │ <─────────────────────    │
  │                            │                           │
  │                            │  Upsert user in DB        │
  │                            │  Set session (userId,     │
  │                            │    sub, username, idToken) │
  │                            │                           │
  │  302 Redirect to /         │                           │
  │ <──────────────────────    │                           │
```

1. User clicks "Log in" in the NavBar, which navigates to `/auth/login`.
2. The server generates a PKCE code verifier and state parameter, stores them in the session, and redirects the browser to Authelia's authorization endpoint.
3. The user authenticates at Authelia (username/password, 2FA, etc.).
4. Authelia redirects back to `/auth/callback` with an authorization code.
5. The server exchanges the code (+ the stored PKCE verifier) for tokens, extracts user info from the ID token claims (falling back to the userinfo endpoint if needed).
6. The user is upserted in the database (created on first login, updated on subsequent logins).
7. The session is set with `userId`, `sub`, `username`, and `idToken`.
8. The browser is redirected to `/`.

### Session

After login, the user's identity is stored in a server-side session. The browser receives an HTTP-only cookie (`nib.sid`) that references the session.

Session properties:
- `userId` — Internal database UUID
- `sub` — OIDC subject identifier
- `username` — Display name
- `idToken` — Stored for the logout hint

Session configuration:
- Cookie name: `nib.sid`
- HTTP-only: yes (not accessible to JavaScript)
- Secure: only in production (`NODE_ENV=production`)
- SameSite: `lax`
- Max age: 7 days
- Trust proxy: enabled (for reverse proxy setups)

### Checking auth state

The client calls `GET /auth/me` on page load to check if the session is still valid.

**Authenticated response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "sub": "authelia-subject-id",
  "username": "alice"
}
```

**Not authenticated response (401):**
```json
{
  "error": "Not authenticated"
}
```

The React `AuthProvider` calls this on mount and exposes the result via `useAuth()`. Components check `user` (non-null = logged in) and `loading` (true while the check is in flight).

### Logout flow

```
Browser                     nib Server                  Authelia
  │                            │                           │
  │  GET /auth/logout          │                           │
  │ ──────────────────────>    │                           │
  │                            │  Destroy session          │
  │                            │  Build end-session URL    │
  │                            │                           │
  │  302 Redirect              │                           │
  │ <──────────────────────    │                           │
  │                            │                           │
  │  GET /end-session?id_token_hint=...&post_logout_redirect_uri=...
  │ ──────────────────────────────────────────────────>    │
  │                            │                           │
  │  302 Redirect to nib       │                           │
  │ <──────────────────────────────────────────────────    │
```

1. User clicks "Log out" in the NavBar, which navigates to `/auth/logout`.
2. The server destroys the session, then redirects to Authelia's end-session endpoint with the ID token hint.
3. Authelia ends its own session and redirects back to nib.

If the end-session URL can't be built (e.g., OIDC discovery fails), the server falls back to redirecting to `/`.

## API route protection

Two middlewares control access:

### `requireAuth`

Returns `401 { error: "Authentication required" }` if `req.session.userId` is not set. Used on all mutating scene routes and `/api/scenes/my`.

### `optionalAuth`

Always passes through. If the user is authenticated, the session data is available to the route handler. Used on `GET /api/scenes/:id` — the handler checks ownership for private scenes.

### Protected routes (client)

The `ProtectedRoute` component wraps routes that require authentication. While `loading` is true, it shows a loading indicator. Once loaded, if `user` is null, it redirects to `/`.

Currently protected:
- `/my` — My Drawings
- `/drawing/new` — New drawing

Not protected (intentionally):
- `/drawing/:id` — Viewing public drawings doesn't require login. The API handles access control for private scenes.

## Authelia configuration

nib must be registered as an OIDC client in Authelia. Example configuration:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: nib
        client_name: nib
        client_secret: '<hashed-secret>'
        public: false
        authorization_policy: one_factor
        redirect_uris:
          - http://draw.grid.local/auth/callback
        post_logout_redirect_uris:
          - http://draw.grid.local
        scopes:
          - openid
          - profile
          - email
        grant_types:
          - authorization_code
        response_types:
          - code
        pkce_challenge_method: S256
```

### Required scopes

- `openid` — Required for OIDC
- `profile` — Provides `preferred_username`, `name`
- `email` — Provides `email`

### Environment variables

Set these on the nib server:

```bash
OIDC_ISSUER=https://authelia.grid.local
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=the-plaintext-secret
OIDC_REDIRECT_URI=http://draw.grid.local/auth/callback
OIDC_POST_LOGOUT_URI=http://draw.grid.local
SESSION_SECRET=a-strong-random-string
```

## User management

There is no user registration or admin panel. Users are created automatically on first OIDC login. On subsequent logins, their profile (username, email, avatar) is updated from the OIDC claims.

The `User.upsert()` on `sub` ensures one database user per OIDC identity, regardless of username or email changes at the provider level.

### What happens when a user is deleted

Deleting a user cascades to all their scenes (PostgreSQL `ON DELETE CASCADE`). There is currently no admin API for user deletion — it would need to be done directly in the database.
