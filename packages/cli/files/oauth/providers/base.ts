// lib/auth/providers/base.ts
//
// Abstract base class for all OAuth providers.
// Extend this to implement a custom provider.

import type { OAuthUserInfo, OAuthProviderId } from "../types";

export interface OAuthProviderConfig {
  /** OAuth client ID from your provider's developer console. */
  clientId: string;
  /** OAuth client secret from your provider's developer console. */
  clientSecret: string;
  /**
   * Override the default OAuth scopes.
   * Leave unset to use the provider's recommended defaults.
   */
  scopes?: string[];
}

/**
 * Abstract base class for OAuth providers.
 *
 * To implement a custom provider:
 *   1. Set `id` (URL segment, e.g. "google") and `name` (display name, e.g. "Google")
 *   2. Implement `getAuthorizationUrl()`, `exchangeCode()`, and `getUserInfo()`
 *
 * @example
 * export class MyProvider extends OAuthProvider {
 *   readonly id = "myprovider";
 *   readonly name = "MyProvider";
 *   // ... implement abstract methods
 * }
 */
export abstract class OAuthProvider {
  /** URL-safe provider identifier. Used in route segments: /api/auth/[id]/login */
  abstract readonly id: OAuthProviderId;
  /** Human-readable provider name. Used in error messages and debug logs. */
  abstract readonly name: string;

  protected readonly config: OAuthProviderConfig;

  constructor(config: OAuthProviderConfig) {
    this.config = config;
  }

  /**
   * Returns the full authorization URL to redirect the user to.
   * The user is sent here to begin the OAuth consent flow.
   *
   * @param params.state                - CSRF state token (generated per request)
   * @param params.redirectUri          - The callback URL registered with the provider
   * @param params.codeChallenge        - PKCE code challenge (base64url(sha256(verifier)))
   * @param params.codeChallengeMethod  - Always "S256"
   * @returns The full authorization URL string to redirect the user to.
   */
  abstract getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }): string;

  /**
   * Exchanges the authorization code (from the callback) for the provider's
   * access token. Called once per successful OAuth callback.
   *
   * @param code         - The authorization code from the callback query string
   * @param redirectUri  - Must match exactly what was used in getAuthorizationUrl
   * @param codeVerifier - PKCE code verifier (the original random value)
   * @returns Promise resolving to the provider's access token.
   * @throws If the code has expired, already been used, or the exchange fails.
   */
  abstract exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{ accessToken: string }>;

  /**
   * Fetches the authenticated user's profile using the provider's access token.
   * The returned `OAuthUserInfo` is passed directly to `adapter.oauthLogin()`.
   *
   * @param accessToken - The provider access token from `exchangeCode()`.
   * @returns Normalized `OAuthUserInfo` containing `id`, `email`, and optional `name`/`picture`.
   * @throws If the access token is invalid or the provider's profile API returns an error.
   */
  abstract getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}
