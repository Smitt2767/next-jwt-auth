"use server";

import { redirect } from "next/navigation";
import {
  clearTokenCookies,
  getTokensFromCookies,
  isTokenValid,
  setTokenCookies,
} from "../core";
import type { ActionResult, SessionActionData } from "../types";
import { TokenPairSchema } from "../types";
import { getGlobalAuthConfig } from "../config";

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

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Fetches the current session from cookies.
 * Attempts a silent token refresh if the access token is expired.
 * Returns { success: true, data: null } if no valid session exists.
 *
 * Used by AuthProvider and revalidateSession to sync client state.
 */
export async function fetchSessionAction(): Promise<
  ActionResult<SessionActionData | null>
> {
  try {
    const config = getGlobalAuthConfig();
    const tokens = await getTokensFromCookies(config);

    if (!tokens) return { success: true, data: null };

    let { accessToken, refreshToken } = tokens;

    if (!isTokenValid(accessToken)) {
      if (!isTokenValid(refreshToken)) {
        await clearTokenCookies(config);
        return { success: true, data: null };
      }
      try {
        const refreshed = await config.adapter.refreshToken(refreshToken);
        const validated = validateTokenPair(refreshed);
        await setTokenCookies(validated, config);
        accessToken = validated.accessToken;
        refreshToken = validated.refreshToken;
      } catch {
        await clearTokenCookies(config);
        return { success: true, data: null };
      }
    }

    const user = await config.adapter.fetchUser(accessToken);
    return { success: true, data: { accessToken, refreshToken, user } };
  } catch (error) {
    return {
      success: false,
      error: extractErrorMessage(error, "Failed to fetch session."),
    };
  }
}

/**
 * Logs the user in with the provided credentials.
 *
 * By default (`redirect: true`) redirects to `redirectTo` or `pages.afterSignIn`
 * after a successful login — matching next-auth behaviour.
 *
 * Set `redirect: false` to disable the automatic redirect and handle
 * navigation yourself on the client based on the returned ActionResult.
 *
 * @example
 * // Default — redirect happens automatically
 * await loginAction({ email, password });
 *
 * // Disable redirect — handle it on the client
 * const result = await loginAction(
 *   { email, password },
 *   { redirect: false }
 * );
 * if (result.success) router.push("/dashboard");
 * else setError(result.error);
 */
export async function loginAction(
  credentials: Record<string, unknown>,
  options: { redirect?: boolean; redirectTo?: string } = {},
): Promise<ActionResult<SessionActionData>> {
  const { redirect: shouldRedirect = true, redirectTo } = options;

  try {
    const config = getGlobalAuthConfig();
    const rawTokens = await config.adapter.login(credentials);
    const tokens = validateTokenPair(rawTokens);
    await setTokenCookies(tokens, config);
    const user = await config.adapter.fetchUser(tokens.accessToken);

    const result: ActionResult<SessionActionData> = {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user,
      },
    };

    if (shouldRedirect) {
      // redirect() throws internally — this line never returns
      redirect(redirectTo ?? config.pages.afterSignIn);
    }

    return result;
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
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
 * or `pages.afterSignOut` — matching next-auth behaviour.
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
  const config = getGlobalAuthConfig();

  try {
    const tokens = await getTokensFromCookies(config);

    if (tokens && config.adapter.logout) {
      try {
        await config.adapter.logout(tokens);
      } catch (adapterError) {
        console.error(
          "[next-jwt-auth] logoutAction: adapter.logout() threw. Cookies will still be cleared.",
          adapterError,
        );
      }
    }

    await clearTokenCookies(config);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    return {
      success: false,
      error: extractErrorMessage(error, "Logout failed. Please try again."),
    };
  }

  if (shouldRedirect) {
    // redirect() throws internally — called outside try/catch so it is never swallowed
    redirect(redirectTo ?? config.pages.afterSignOut);
  }

  return { success: true, data: null };
}

/**
 * Forces a token refresh using the current refresh token.
 * Updates cookies with the new token pair and returns the refreshed session.
 */
export async function refreshSessionAction(): Promise<
  ActionResult<SessionActionData>
> {
  try {
    const config = getGlobalAuthConfig();
    const tokens = await getTokensFromCookies(config);

    if (!tokens) {
      return { success: false, error: "No session found. Please log in." };
    }

    if (!isTokenValid(tokens.refreshToken)) {
      await clearTokenCookies(config);
      return {
        success: false,
        error: "Session expired. Please log in again.",
      };
    }

    const rawRefreshed = await config.adapter.refreshToken(tokens.refreshToken);
    const refreshed = validateTokenPair(rawRefreshed);
    await setTokenCookies(refreshed, config);
    const user = await config.adapter.fetchUser(refreshed.accessToken);

    return {
      success: true,
      data: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        user,
      },
    };
  } catch (error) {
    const config = getGlobalAuthConfig();
    await clearTokenCookies(config).catch(() => {});
    return {
      success: false,
      error: extractErrorMessage(error, "Session refresh failed."),
    };
  }
}
