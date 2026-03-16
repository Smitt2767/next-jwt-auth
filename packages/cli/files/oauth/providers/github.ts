// lib/auth/providers/github.ts

import type { OAuthUserInfo } from "../../lib/auth/types";
import { OAuthProvider, type OAuthProviderConfig } from "./base";

const DEFAULT_SCOPES = ["user:email", "read:user"];
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

/**
 * GitHub OAuth provider.
 *
 * Required env vars:
 *   GITHUB_CLIENT_ID     — from GitHub → Settings → Developer settings → OAuth Apps
 *   GITHUB_CLIENT_SECRET — same location
 *
 * Callback URL to register in your GitHub OAuth App:
 *   https://your-domain.com/api/auth/github/callback
 *
 * @example
 * new GitHubProvider({
 *   clientId: process.env.GITHUB_CLIENT_ID!,
 *   clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 * })
 */
export class GitHubProvider extends OAuthProvider {
  readonly id = "github";
  readonly name = "GitHub";

  constructor(config: OAuthProviderConfig) {
    super(config);
  }

  /**
   * Builds the GitHub OAuth authorization URL with PKCE.
   *
   * @param params.state                - CSRF state token (generated per request)
   * @param params.redirectUri          - Registered callback URL
   * @param params.codeChallenge        - PKCE code challenge
   * @param params.codeChallengeMethod  - Always "S256"
   * @returns The full GitHub authorization URL to redirect the user to.
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
      scope: (this.config.scopes ?? DEFAULT_SCOPES).join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    });
    return `${GITHUB_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code for a GitHub access token.
   *
   * @param code         - Authorization code from the callback query string.
   * @param redirectUri  - Must match the URL used in `getAuthorizationUrl`.
   * @param codeVerifier - PKCE code verifier (the original random value).
   * @returns The GitHub access token.
   * @throws If the token exchange request fails or GitHub returns an error response.
   */
  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<{ accessToken: string }> {
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub token exchange failed: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new Error(
        `GitHub OAuth error: ${data.error_description ?? data.error}`,
      );
    }

    return { accessToken: data.access_token };
  }

  /**
   * Fetches the authenticated user's profile from GitHub's user API.
   * Falls back to the emails endpoint if email is not present in the main user response.
   *
   * @param accessToken - GitHub access token from `exchangeCode()`.
   * @returns Normalized user info with `id`, `email`, `name`, and `picture` (avatar URL).
   * @throws If no verified email can be retrieved, or if any GitHub API call fails.
   */
  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    };

    const userResponse = await fetch(GITHUB_USER_URL, { headers });
    if (!userResponse.ok) {
      throw new Error(
        `Failed to fetch GitHub user: ${userResponse.statusText}`,
      );
    }

    const user = (await userResponse.json()) as {
      id: number;
      login: string;
      name?: string;
      avatar_url?: string;
      email?: string | null;
    };

    // GitHub may not return email in the user object — fetch it separately
    let email = user.email ?? null;
    if (!email) {
      const emailsResponse = await fetch(GITHUB_EMAILS_URL, { headers });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails[0]?.email ??
          null;
      }
    }

    if (!email) {
      throw new Error(
        "Could not retrieve a verified email from GitHub. " +
          "Make sure the 'user:email' scope is requested.",
      );
    }

    return {
      id: String(user.id),
      email,
      name: user.name ?? user.login,
      picture: user.avatar_url,
      raw: user as Record<string, unknown>,
    };
  }
}
