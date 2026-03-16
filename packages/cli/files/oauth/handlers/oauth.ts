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
const PKCE_COOKIE_NAME = "oauth_pkce_verifier";
const CALLBACK_URL_COOKIE_NAME = "oauth_callback_url";
const STATE_COOKIE_MAX_AGE = 600; // 10 minutes

// ── PKCE helpers ───────────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64urlEncode(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64urlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

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
      const { codeVerifier, codeChallenge } = await generatePKCE();
      const authorizationUrl = provider.getAuthorizationUrl({
        state,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
      });
      const { searchParams: loginParams } = new URL(request.url);
      const callbackUrl = loginParams.get("callbackUrl");

      debugLog(`OAuth: initiating ${provider.name} login`, {
        state: state.slice(0, 8) + "...",
        callbackUrl: callbackUrl ?? "(none)",
      });

      const cookieOpts = {
        httpOnly: true,
        secure: config.cookieOptions.secure,
        sameSite: "lax" as const,
        path: "/",
        maxAge: STATE_COOKIE_MAX_AGE,
      };

      const response = NextResponse.redirect(authorizationUrl);
      response.cookies.set(STATE_COOKIE_NAME, state, cookieOpts);
      response.cookies.set(PKCE_COOKIE_NAME, codeVerifier, cookieOpts);

      // Persist callbackUrl across the provider redirect so the callback can
      // use it — the provider strips all custom query params from the return URL.
      if (callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
        response.cookies.set(CALLBACK_URL_COOKIE_NAME, callbackUrl, cookieOpts);
      }

      return response;
    }

    // ── Callback: complete OAuth flow ──────────────────────────────────────────
    if (action === "callback") {
      const { searchParams } = new URL(request.url);
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const storedState = request.cookies.get(STATE_COOKIE_NAME)?.value;
      const codeVerifier = request.cookies.get(PKCE_COOKIE_NAME)?.value;
      const callbackUrl = request.cookies.get(CALLBACK_URL_COOKIE_NAME)?.value;

      const clearAuthCookies = (res: NextResponse) => {
        res.cookies.delete(STATE_COOKIE_NAME);
        res.cookies.delete(PKCE_COOKIE_NAME);
        res.cookies.delete(CALLBACK_URL_COOKIE_NAME);
      };

      // Validate CSRF state + PKCE verifier presence
      if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
        debugLog("OAuth: state mismatch, missing code, or missing PKCE verifier", {
          hasCode: !!code,
          hasState: !!state,
          hasStoredState: !!storedState,
          hasPkce: !!codeVerifier,
        });
        signInUrl.searchParams.set("error", "OAuthStateMismatch");
        const response = NextResponse.redirect(signInUrl);
        clearAuthCookies(response);
        return response;
      }

      try {
        // Exchange code for provider access token (with PKCE verifier)
        debugLog(`OAuth: exchanging code for ${provider.name} access token`);
        const { accessToken: providerToken } = await provider.exchangeCode(
          code,
          redirectUri,
          codeVerifier,
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
        clearAuthCookies(successResponse);

        debugLog(`OAuth: login complete, redirecting to ${destination}`);
        return successResponse;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "OAuthCallbackError";
        debugLog("OAuth: error during callback", { error: message });

        signInUrl.searchParams.set("error", encodeURIComponent(message));
        const response = NextResponse.redirect(signInUrl);
        clearAuthCookies(response);
        return response;
      }
    }

    // Unknown action — redirect to sign-in
    return NextResponse.redirect(signInUrl);
  };
}
