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
   * @param params.state       - CSRF state token (generated per request)
   * @param params.redirectUri - The callback URL registered with the provider
   */
  abstract getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
  }): string;

  /**
   * Exchanges the authorization code (from the callback) for the provider's
   * access token. Called once per successful OAuth callback.
   *
   * @param code        - The authorization code from the callback query string
   * @param redirectUri - Must match exactly what was used in getAuthorizationUrl
   */
  abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }>;

  /**
   * Fetches the authenticated user's profile using the provider's access token.
   * The returned `OAuthUserInfo` is passed directly to `adapter.oauthLogin()`.
   *
   * @param accessToken - The provider access token from exchangeCode()
   */
  abstract getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}
