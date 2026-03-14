// lib/auth/handlers/oauth.ts
//
// Core OAuth route handler. Processes login + callback requests for all providers.
// This file is managed by @smittdev/next-jwt-auth — do not edit directly.
// Configure providers in auth.ts instead.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getGlobalAuthConfig, debugLog } from "../config";
import { setTokenCookies } from "../core/cookies";
import { TokenPairSchema, type OAuthProviderId } from "../types";

const STATE_COOKIE_NAME = "oauth_state";
const STATE_COOKIE_MAX_AGE = 600; // 10 minutes

/**
 * Creates the GET handler for the OAuth catch-all route.
 *
 * Handles two URL patterns:
 *   GET /api/auth/[provider]/login    — initiates the OAuth flow
 *   GET /api/auth/[provider]/callback — completes the OAuth flow
 *
 * Flow:
 *   login    → generate CSRF state → set state cookie → redirect to provider
 *   callback → validate state → exchange code → fetch user → call adapter.oauthLogin()
 *            → set session cookies → redirect to app
 *
 * Errors at any step redirect to `config.pages.signIn?error=<message>`.
 */
export function createOAuthHandler() {
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ oauth: string[] }> },
  ): Promise<NextResponse> {
    const config = getGlobalAuthConfig();
    const { oauth } = await params;
    const [providerId, action] = oauth;

    const origin = new URL(request.url).origin;
    const signInUrl = new URL(config.pages.signIn, origin);

    // ── Find provider ──────────────────────────────────────────────────────────
    const provider = (config.providers ?? []).find((p) => p.id === providerId);
    if (!provider) {
      debugLog(`OAuth: unknown provider "${providerId}"`);
      signInUrl.searchParams.set("error", "InvalidProvider");
      return NextResponse.redirect(signInUrl);
    }

    const redirectUri = `${origin}/api/auth/${providerId}/callback`;

    // ── Login: initiate OAuth flow ─────────────────────────────────────────────
    if (action === "login") {
      const state = crypto.randomUUID();
      const authorizationUrl = provider.getAuthorizationUrl({ state, redirectUri });

      debugLog(`OAuth: initiating ${provider.name} login`, {
        state: state.slice(0, 8) + "...",
      });

      const response = NextResponse.redirect(authorizationUrl);
      response.cookies.set(STATE_COOKIE_NAME, state, {
        httpOnly: true,
        secure: config.cookieOptions.secure,
        sameSite: "lax",
        path: "/",
        maxAge: STATE_COOKIE_MAX_AGE,
      });
      return response;
    }

    // ── Callback: complete OAuth flow ──────────────────────────────────────────
    if (action === "callback") {
      const { searchParams } = new URL(request.url);
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const storedState = request.cookies.get(STATE_COOKIE_NAME)?.value;
      const callbackUrl = searchParams.get("callbackUrl");

      // Validate CSRF state
      if (!code || !state || !storedState || state !== storedState) {
        debugLog("OAuth: state mismatch or missing code", {
          hasCode: !!code,
          hasState: !!state,
          hasStoredState: !!storedState,
        });
        signInUrl.searchParams.set("error", "OAuthStateMismatch");
        const response = NextResponse.redirect(signInUrl);
        response.cookies.delete(STATE_COOKIE_NAME);
        return response;
      }

      try {
        // Exchange code for provider access token
        debugLog(`OAuth: exchanging code for ${provider.name} access token`);
        const { accessToken: providerToken } = await provider.exchangeCode(
          code,
          redirectUri,
        );

        // Fetch user profile from provider
        debugLog(`OAuth: fetching user info from ${provider.name}`);
        const userInfo = await provider.getUserInfo(providerToken);

        // Call user's backend adapter
        if (!config.adapter.oauthLogin) {
          throw new Error(
            "[next-jwt-auth] adapter.oauthLogin() is not implemented.\n" +
              "Add an oauthLogin() function to your adapter in auth.ts to handle OAuth logins.",
          );
        }

        debugLog(`OAuth: calling adapter.oauthLogin`, {
          provider: providerId,
          userId: userInfo.id,
        });
        const tokens = await config.adapter.oauthLogin(
          provider.id satisfies OAuthProviderId,
          userInfo,
          providerToken,
        );

        // Validate + set session cookies
        const validated = TokenPairSchema.parse(tokens);
        await setTokenCookies(validated, config);

        // Redirect to destination
        const destination = callbackUrl ?? config.pages.home;
        const successResponse = NextResponse.redirect(
          new URL(destination, origin),
        );
        successResponse.cookies.delete(STATE_COOKIE_NAME);

        debugLog(`OAuth: login complete, redirecting to ${destination}`);
        return successResponse;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "OAuthCallbackError";
        debugLog("OAuth: error during callback", { error: message });

        signInUrl.searchParams.set("error", encodeURIComponent(message));
        const response = NextResponse.redirect(signInUrl);
        response.cookies.delete(STATE_COOKIE_NAME);
        return response;
      }
    }

    // Unknown action — redirect to sign-in
    return NextResponse.redirect(signInUrl);
  };
}
