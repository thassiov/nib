# Authentication

nib uses OpenID Connect (OIDC) with PKCE for authentication, delegating identity management to any OIDC-compliant provider (tested with Authelia).

## How it works

### Login flow

```
Browser                     nib Server                  OIDC Provider
  │                            │                           │
  │  GET /auth/login           │                           │
  │    ?returnTo=/drawing/abc  │                           │
  │ ──────────────────────>    │                           │
  │                            │  Generate PKCE verifier   │
  │                            │  + state, store in session│
  │                            │  Store returnTo in session│
  │                            │                           │
  │  302 Redirect              │                           │
  │ <──────────────────────    │                           │
  │                            │                           │
  │  GET /authorize?code_challenge=...&state=...           │
  │ ──────────────────────────────────────────────────>    │
  │                            │                           │
  │  User logs in              │                           │
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
  │                            │  Determine role (admin?)  │
  │                            │  Adopt anonymous scenes   │
  │                            │  Set session              │
  │                            │                           │
  │  302 Redirect to returnTo  │                           │
  │ <──────────────────────    │                           │
```

1. User clicks "Log in" in the NavBar, which navigates to `/auth/login`.
2. The server generates a PKCE code verifier and state parameter, stores them in the session. If `?returnTo=/path` is provided (and starts with `/` to prevent open redirects), it is saved to `session.returnTo`.
3. The browser is redirected to the OIDC provider's authorization endpoint.
4. The user authenticates (username/password, 2FA, etc.).
5. The provider redirects back to `/auth/callback` with an authorization code.
6. The server exchanges the code (+ the stored PKCE verifier) for tokens, extracts user info from the ID token claims (falling back to the userinfo endpoint if needed).
7. The user is upserted in the database (created on first login, updated on subsequent logins). The role is set based on whether the user's OIDC `sub` appears in the `ADMIN_SUBS` env var.
8. **Scene adoption:** If `session.ownedScenes` has entries (scene IDs created anonymously during this session), those scenes are reassigned to the now-authenticated user via `scenesRepository.adoptByIds()`. Then `session.ownedScenes` is cleared.
9. The session is set with `userId`, `sub`, `username`, `role`, and `idToken`.
10. The browser is redirected to `session.returnTo` (or `/` if not set).

### Session

After login, the user's identity is stored in a server-side session backed by PostgreSQL (`connect-pg-simple`). The browser receives an HTTP-only cookie (`nib.sid`) that references the session.

Session properties:
- `userId` — Internal database UUID
- `sub` — OIDC subject identifier
- `username` — Display name
- `role` — `"admin"` or `"user"`
- `idToken` — Stored for the logout hint
- `ownedScenes` — Scene IDs created anonymously in this session (cleared on login)
- `returnTo` — URL to redirect to after login (cleared after use)

Session configuration:
- Cookie name: `nib.sid`
- HTTP-only: yes (not accessible to JavaScript)
- Secure: controlled by `COOKIE_SECURE` env var (set to `true` behind TLS proxy)
- SameSite: `lax`
- Max age: 30 days
- Trust proxy: enabled (for reverse proxy setups)
- Store: PostgreSQL (production) or in-memory (development without `DB_HOST`)

### Checking auth state

The client calls `GET /auth/me` on page load to check if the session is still valid.

**Authenticated response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "sub": "oidc-subject-id",
  "username": "alice",
  "role": "user"
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
Browser                     nib Server                  OIDC Provider
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
2. The server captures the `idToken`, destroys the session, then redirects to the provider's end-session endpoint with the ID token hint.
3. The provider ends its own session and redirects back to nib.

If the end-session URL can't be built (e.g., OIDC discovery fails), the server falls back to redirecting to `/`.

## API route protection

Three guards control access:

### AuthGuard

Returns 403 if `req.session.userId` is not set. Used on routes that strictly require authentication (e.g., `GET /api/scenes/my`, `DELETE /api/scenes/:id`).

### OptionalAuthGuard

Always passes through. If the user is authenticated, the session data is available to the route handler. Used on most scene routes — the handler checks ownership for private scenes and uses `session.ownedScenes` for anonymous ownership.

### AdminGuard

Returns 403 if `session.userId` is not set or `session.role !== "admin"`. Used for admin-only features.

### Protected routes (client)

The `ProtectedRoute` component wraps routes that require authentication. While `loading` is true, it shows a loading indicator. Once loaded, if `user` is null, it redirects to `/`.

Currently protected:
- `/my` — My Drawings

Not protected (intentionally):
- `/drawing/:id` — Viewing public drawings doesn't require login. The API handles access control for private scenes. The `canEdit` flag determines whether the editor is in edit or view-only mode.

## Anonymous ownership

Anonymous users can create and edit drawings without an account. When an anonymous user creates a scene, the scene's `user_id` is `null` and the scene ID is added to `session.ownedScenes`.

The `canEdit` flag returned by `GET /api/scenes/:id` is `true` when:
- The authenticated user is the scene owner (`scene.user_id === session.userId`), or
- The scene ID is in `session.ownedScenes` (anonymous creator, same session)

When an anonymous user tries to make a drawing private, the client prompts them to log in instead (since private drawings without an owner would be inaccessible after session expiry).

When the anonymous user logs in:
1. `auth.controller.ts` calls `scenesRepository.adoptByIds(session.ownedScenes, user.id)` to set `user_id` on all session-owned scenes
2. `session.ownedScenes` is cleared
3. The user is redirected to `session.returnTo` (preserving their current page)

If the session expires (30-day TTL) before the user logs in, the anonymous scenes become permanently read-only — they remain in the public gallery but can no longer be edited by anyone.

## User roles

Roles are determined at login time by checking the `ADMIN_SUBS` environment variable — a comma-separated list of OIDC subject IDs that should receive the `admin` role. All other users get the `user` role.

Admin-only features:
- Remote logging toggle in the NavBar

## OIDC provider configuration

nib must be registered as an OIDC client with your provider. Example configuration for Authelia:

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
          - https://your-nib-domain.example.com/auth/callback
        post_logout_redirect_uris:
          - https://your-nib-domain.example.com
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
OIDC_ISSUER=https://your-oidc-provider.example.com
OIDC_CLIENT_ID=nib
OIDC_CLIENT_SECRET=the-plaintext-secret
OIDC_REDIRECT_URI=https://your-nib-domain.example.com/auth/callback
OIDC_POST_LOGOUT_URI=https://your-nib-domain.example.com
SESSION_SECRET=a-strong-random-string
ADMIN_SUBS=oidc-subject-id-1,oidc-subject-id-2
```

## User management

There is no user registration or admin panel. Users are created automatically on first OIDC login. On subsequent logins, their profile (username, email, avatar) is updated from the OIDC claims.

The `User.upsert()` on `sub` ensures one database user per OIDC identity, regardless of username or email changes at the provider level.

### What happens when a user is deleted

Deleting a user cascades to all their scenes (PostgreSQL `ON DELETE CASCADE`). There is currently no admin API for user deletion — it would need to be done directly in the database.
