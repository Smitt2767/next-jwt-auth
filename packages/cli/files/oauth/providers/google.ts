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

  getAuthorizationUrl({
    state,
    redirectUri,
  }: {
    state: string;
    redirectUri: string;
  }): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (this.config.scopes ?? DEFAULT_SCOPES).join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
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
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google token exchange failed: ${error}`);
    }

    const data = (await response.json()) as { access_token: string };
    return { accessToken: data.access_token };
  }

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
