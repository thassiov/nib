import { Injectable } from "@nestjs/common";
import {
  buildLoginUrl,
  handleCallback,
  buildLogoutUrl,
  resetConfig,
} from "./oidc.js";
import type { OIDCUserInfo } from "./oidc.js";

@Injectable()
export class AuthService {
  /**
   * Build the OIDC authorization URL and return PKCE parameters for session storage.
   */
  async buildLoginUrl(): Promise<{ url: URL; code_verifier: string; state: string }> {
    return buildLoginUrl();
  }

  /**
   * Exchange the authorization code for tokens and user info.
   */
  async handleCallback(
    callbackUrl: URL,
    code_verifier: string,
    expectedState: string,
  ): Promise<{ userInfo: OIDCUserInfo; idToken: string | undefined }> {
    return handleCallback(callbackUrl, code_verifier, expectedState);
  }

  /**
   * Build the end-session URL for OIDC logout.
   */
  async buildLogoutUrl(idTokenHint?: string): Promise<URL> {
    return buildLogoutUrl(idTokenHint);
  }

  /**
   * Reset cached OIDC discovery configuration.
   */
  resetConfig(): void {
    resetConfig();
  }
}
