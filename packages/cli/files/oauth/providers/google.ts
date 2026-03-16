// lib/auth/providers/google.ts

import type { OAuthUserInfo } from "../types";
import { OAuthProvider, type OAuthProviderConfig } from "./base";

const DEFAULT_SCOPES = ["openid", "email", "profile"];
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Google OAuth 2.0 provider.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID     — from Google Cloud Console → APIs & Services → Credentials
 *   GOOGLE_CLIENT_SECRET — same location
 *
 * Callback URL to register in Google Cloud Console:
 *   https://your-domain.com/api/auth/google/callback
 *
 * @example
 * new GoogleProvider({
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 * })
 */
export class GoogleProvider extends OAuthProvider {
  readonly id = "google";
  readonly name = "Google";

  constructor(config: OAuthProviderConfig) {
    super(config);
  }

  /**
   * Builds the Google OAuth 2.0 authorization URL with PKCE.
   *
   * @param params.state                - CSRF state token (generated per request)
   * @param params.redirectUri          - Registered callback URL
   * @param params.codeChallenge        - PKCE code challenge
   * @param params.codeChallengeMethod  - Always "S256"
   * @returns The full Google authorization URL to redirect the user to.
   */
  getAuthorizationUrl({
    state,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
  }: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (this.config.scopes ?? DEFAULT_SCOPES).join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code for a Google access token.
   *
   * @param code         - Authorization code from the callback query string.
   * @param redirectUri  - Must match the URL used in `getAuthorizationUrl`.
   * @param codeVerifier - PKCE code verifier (the original random value).
   * @returns The Google access token.
   * @throws If the token exchange request fails or Google returns an error response.
   */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{ accessToken: string }> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google token exchange failed: ${error}`);
    }

    const data = (await response.json()) as { access_token: string };
    return { accessToken: data.access_token };
  }

  /**
   * Fetches the authenticated user's profile from Google's userinfo endpoint.
   *
   * @param accessToken - Google access token from `exchangeCode()`.
   * @returns Normalized user info with `id` (Google's `sub`), `email`, `name`, and `picture`.
   * @throws If the userinfo request fails or returns a non-OK status.
   */
  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Google user info: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
      raw: data as Record<string, unknown>,
    };
  }
}
