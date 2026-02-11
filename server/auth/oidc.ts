/**
 * Authelia OIDC integration using openid-client v6.
 *
 * Handles discovery, authorization URL building, token exchange,
 * and userinfo fetching. Stateless module - session management
 * is handled by Express middleware.
 *
 * Environment variables:
 *   OIDC_ISSUER       - Authelia issuer URL (e.g. https://authelia.grid.local)
 *   OIDC_CLIENT_ID    - Client ID registered in Authelia
 *   OIDC_CLIENT_SECRET - Client secret
 *   OIDC_REDIRECT_URI - Callback URL (e.g. http://draw.grid.local/auth/callback)
 *   OIDC_POST_LOGOUT_URI - Where to go after logout (e.g. http://draw.grid.local)
 */

import * as client from "openid-client";

// --- Configuration ---

const ISSUER = process.env.OIDC_ISSUER || "https://authelia.grid.local";
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "nib";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || "http://draw.grid.local/auth/callback";
const POST_LOGOUT_URI = process.env.OIDC_POST_LOGOUT_URI || "http://draw.grid.local";
const SCOPES = "openid profile email";

// --- Discovery (cached) ---

let config: client.Configuration | null = null;

async function getConfig(): Promise<client.Configuration> {
  if (!config) {
    config = await client.discovery(
      new URL(ISSUER),
      CLIENT_ID,
      CLIENT_SECRET,
    );
  }
  return config;
}

// --- Public API ---

export interface OIDCUserInfo {
  sub: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  picture?: string;
}

/**
 * Build the authorization URL to redirect the user to Authelia.
 * Returns the URL and the code_verifier (must be stored in session for callback).
 */
export async function buildLoginUrl(): Promise<{ url: URL; code_verifier: string; state: string }> {
  const cfg = await getConfig();

  const code_verifier = client.randomPKCECodeVerifier();
  const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
  const state = client.randomState();

  const parameters: Record<string, string> = {
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge,
    code_challenge_method: "S256",
    state,
  };

  const url = client.buildAuthorizationUrl(cfg, parameters);

  return { url, code_verifier, state };
}

/**
 * Exchange the authorization code for tokens and fetch user info.
 * Requires the code_verifier and state from the original login request.
 */
export async function handleCallback(
  callbackUrl: URL,
  code_verifier: string,
  expectedState: string,
): Promise<{ userInfo: OIDCUserInfo; idToken: string | undefined }> {
  const cfg = await getConfig();

  const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
    pkceCodeVerifier: code_verifier,
    expectedState,
    idTokenExpected: true,
  });

  const claims = tokens.claims();

  // Build user info from ID token claims first
  const userInfo: OIDCUserInfo = {
    sub: claims?.sub || "",
    preferred_username: claims?.preferred_username as string | undefined,
    name: claims?.name as string | undefined,
    email: claims?.email as string | undefined,
    picture: claims?.picture as string | undefined,
  };

  // If we didn't get enough from the ID token, fetch from userinfo endpoint
  if (!userInfo.preferred_username && !userInfo.email) {
    try {
      const info = await client.fetchUserInfo(cfg, tokens.access_token, userInfo.sub);
      userInfo.preferred_username = info.preferred_username as string | undefined;
      userInfo.name = info.name as string | undefined;
      userInfo.email = info.email as string | undefined;
      userInfo.picture = info.picture as string | undefined;
    } catch {
      // userinfo endpoint may not be available, that's fine
    }
  }

  return {
    userInfo,
    idToken: tokens.id_token,
  };
}

/**
 * Build the end-session (logout) URL for Authelia.
 */
export async function buildLogoutUrl(idTokenHint?: string): Promise<URL> {
  const cfg = await getConfig();

  const parameters: Record<string, string> = {
    post_logout_redirect_uri: POST_LOGOUT_URI,
  };

  if (idTokenHint) {
    parameters.id_token_hint = idTokenHint;
  }

  return client.buildEndSessionUrl(cfg, parameters);
}

/**
 * Reset the cached OIDC configuration.
 * Useful if Authelia restarts or keys rotate.
 */
export function resetConfig(): void {
  config = null;
}
