"use server";

import { redirect } from "next/navigation";
import {
  clearTokenCookies,
  getTokensFromCookies,
  isTokenValid,
  setTokenCookies,
} from "../core";
import type {
  ActionResult,
  LoginActionOptions,
  SessionActionData,
} from "../types";
import { TokenPairSchema } from "../types";
import { getGlobalAuthConfig, debugLog } from "../config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function validateTokenPair(tokens: unknown) {
  return TokenPairSchema.parse(tokens);
}

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as Record<string, unknown>).digest === "string" &&
    ((error as Record<string, unknown>).digest as string).startsWith(
      "NEXT_REDIRECT",
    )
  );
}

/**
 * Validates a callbackUrl to prevent open-redirect attacks.
 * Only root-relative paths (starting with "/" but not "//") are allowed.
 * Any other value — absolute URLs, protocol-relative URLs, empty strings —
 * is rejected and returns undefined, falling back to pages.home.
 */
function sanitizeCallbackUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Allow root-relative paths only — blocks `//evil.com` and `https://evil.com`
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  debugLog("sanitizeCallbackUrl: rejected unsafe callbackUrl", { url });
  return undefined;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Fetches the current session from cookies and returns fresh session data.
 *
 * If the access token is expired but a valid refresh token exists, this action
 * silently rotates the token pair (calls adapter.refreshToken, updates cookies)
 * before resolving the session — the caller always receives a valid, up-to-date
 * session or null, never a stale/expired one.
 *
 * Returns { success: true, data: null } if no valid session exists at all.
 *
 * Used internally by AuthProvider on mount and on tab focus via fetchSession.
 */
export async function fetchSessionAction(): Promise<
  ActionResult<SessionActionData | null>
> {
  debugLog("fetchSessionAction: called");

  try {
    const config = getGlobalAuthConfig();
    const tokens = await getTokensFromCookies(config);

    if (!tokens) {
      debugLog("fetchSessionAction: no tokens found in cookies");
      return { success: true, data: null };
    }

    let { accessToken, refreshToken } = tokens;

    if (!isTokenValid(accessToken)) {
      debugLog("fetchSessionAction: access token invalid — attempting refresh");

      if (!isTokenValid(refreshToken)) {
        debugLog(
          "fetchSessionAction: refresh token also invalid — clearing cookies",
        );
        await clearTokenCookies(config);
        return { success: true, data: null };
      }

      try {
        const refreshed = await config.adapter.refreshToken(refreshToken);
        const validated = validateTokenPair(refreshed);
        await setTokenCookies(validated, config);
        accessToken = validated.accessToken;
        refreshToken = validated.refreshToken;
        debugLog("fetchSessionAction: token refresh successful");
      } catch (refreshError) {
        debugLog(
          "fetchSessionAction: token refresh failed — clearing cookies",
          {
            error:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          },
        );
        await clearTokenCookies(config);
        return { success: true, data: null };
      }
    }

    const user = await config.adapter.fetchUser(accessToken);
    debugLog("fetchSessionAction: session resolved", { userId: user.id });
    return { success: true, data: { accessToken, refreshToken, user } };
  } catch (error) {
    debugLog("fetchSessionAction: unexpected error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: extractErrorMessage(error, "Failed to fetch session."),
    };
  }
}

/**
 * Logs the user in with the provided credentials.
 *
 * By default (`redirect: true`) redirects after a successful login using
 * the first truthy value in this priority order:
 *   1. `options.redirectTo`  — explicit override, always wins
 *   2. `options.callbackUrl` — typically the `?callbackUrl=` param set by
 *      requireSession(); validated to prevent open-redirect attacks
 *   3. `config.pages.home` — the configured default
 *
 * Set `redirect: false` to disable the automatic redirect and handle
 * navigation yourself on the client based on the returned ActionResult.
 *
 * @example
 * // Default — redirect to pages.home
 * await loginAction({ email, password });
 *
 * // Honour the callbackUrl from the URL search params
 * const result = await loginAction(
 *   { email, password },
 *   { callbackUrl: searchParams.get("callbackUrl") ?? undefined },
 * );
 *
 * // Disable redirect entirely — handle navigation on the client
 * const result = await loginAction(
 *   { email, password },
 *   { redirect: false },
 * );
 * if (result.success) router.push("/dashboard");
 * else setError(result.error);
 */
export async function loginAction(
  credentials: Record<string, unknown>,
  options: LoginActionOptions = {},
): Promise<ActionResult<SessionActionData>> {
  const { redirect: shouldRedirect = true, redirectTo, callbackUrl } = options;

  debugLog("loginAction: called", {
    shouldRedirect,
    hasCallbackUrl: !!callbackUrl,
  });

  try {
    const config = getGlobalAuthConfig();
    const rawTokens = await config.adapter.login(credentials);
    const tokens = validateTokenPair(rawTokens);
    await setTokenCookies(tokens, config);
    const user = await config.adapter.fetchUser(tokens.accessToken);

    debugLog("loginAction: login successful", { userId: user.id });

    const result: ActionResult<SessionActionData> = {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user,
      },
    };

    if (shouldRedirect) {
      // Priority: explicit redirectTo > sanitized callbackUrl > configured default
      const destination =
        redirectTo ??
        sanitizeCallbackUrl(callbackUrl) ??
        config.pages.home;

      debugLog("loginAction: redirecting", { destination });
      // redirect() throws internally — this line never returns
      redirect(destination);
    }

    return result;
  } catch (error) {
    if (isNextRedirectError(error)) throw error;

    debugLog("loginAction: login failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    const config = getGlobalAuthConfig();
    await clearTokenCookies(config).catch(() => {});
    return {
      success: false,
      error: extractErrorMessage(error, "Login failed. Please try again."),
    };
  }
}

/**
 * Logs the user out.
 *
 * By default (`redirect: true`) clears cookies and redirects to `redirectTo`
 * or `pages.signIn` — matching next-auth behaviour.
 *
 * Set `redirect: false` to disable the automatic redirect and handle
 * navigation yourself on the client based on the returned ActionResult.
 *
 * @example
 * // Default — redirect happens automatically
 * await logoutAction();
 *
 * // Custom redirect target
 * await logoutAction({ redirectTo: "/login" });
 *
 * // Disable redirect — handle it on the client
 * const result = await logoutAction({ redirect: false });
 * if (result.success) router.replace("/");
 */
export async function logoutAction(
  options: { redirect?: boolean; redirectTo?: string } = {},
): Promise<ActionResult<null>> {
  const { redirect: shouldRedirect = true, redirectTo } = options;

  debugLog("logoutAction: called", { shouldRedirect });

  const config = getGlobalAuthConfig();

  try {
    const tokens = await getTokensFromCookies(config);

    if (tokens && config.adapter.logout) {
      try {
        await config.adapter.logout(tokens);
        debugLog("logoutAction: adapter.logout() completed");
      } catch (adapterError) {
        // Non-fatal — cookies will still be cleared regardless
        debugLog(
          "logoutAction: adapter.logout() threw — cookies will still be cleared",
          {
            error:
              adapterError instanceof Error
                ? adapterError.message
                : String(adapterError),
          },
        );
        console.error(
          "[next-jwt-auth] logoutAction: adapter.logout() threw. Cookies will still be cleared.",
          adapterError,
        );
      }
    }

    await clearTokenCookies(config);
    debugLog("logoutAction: cookies cleared");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    debugLog("logoutAction: unexpected error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: extractErrorMessage(error, "Logout failed. Please try again."),
    };
  }

  if (shouldRedirect) {
    const destination = redirectTo ?? config.pages.signIn;
    debugLog("logoutAction: redirecting", { destination });
    // redirect() is called outside try/catch so it is never swallowed
    redirect(destination);
  }

  return { success: true, data: null };
}

/**
 * Updates the session's access token manually.
 *
 * This is useful when the user is handling token refreshes on the client side
 * via an Axios interceptor (or similar) instead of relying on the Next.js middleware.
 * If the user's external API returns a new access token, they can call this action
 * to sync it into the HttpOnly cookies so Server Components can see it.
 */
export async function updateSessionTokenAction(
  newAccessToken: string,
): Promise<ActionResult<SessionActionData>> {
  debugLog("updateSessionTokenAction: called");

  if (!newAccessToken || typeof newAccessToken !== "string") {
    return { success: false, error: "Invalid access token provided." };
  }

  try {
    const config = getGlobalAuthConfig();
    const tokens = await getTokensFromCookies(config);

    if (!tokens) {
      return { success: false, error: "No active session to update." };
    }

    const newTokens = {
      accessToken: newAccessToken,
      refreshToken: tokens.refreshToken,
    };

    const validated = validateTokenPair(newTokens);
    await setTokenCookies(validated, config);
    const user = await config.adapter.fetchUser(validated.accessToken);

    debugLog("updateSessionTokenAction: session token updated", { userId: user.id });

    return {
      success: true,
      data: {
        accessToken: validated.accessToken,
        refreshToken: validated.refreshToken,
        user,
      },
    };
  } catch (error) {
    debugLog("updateSessionTokenAction: unexpected error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: extractErrorMessage(error, "Failed to update session token."),
    };
  }
}

