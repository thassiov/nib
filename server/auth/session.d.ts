import "express-session";

/**
 * Augment express-session to include our custom session fields.
 */
declare module "express-session" {
  interface SessionData {
    /** OIDC PKCE code verifier (transient, used during login flow) */
    code_verifier?: string;
    /** OIDC state parameter (transient, used during login flow) */
    oidc_state?: string;
    /** Authenticated user's internal DB ID */
    userId?: string;
    /** Authenticated user's OIDC subject */
    sub?: string;
    /** Display name */
    username?: string;
    /** User role: 'admin' or 'user' */
    role?: string;
    /** Scene IDs created in this session (anonymous ownership) */
    ownedScenes?: string[];
    /** Page to redirect back to after OIDC login */
    returnTo?: string;
    /** ID token for logout hint */
    idToken?: string;
  }
}
