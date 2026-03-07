// lib/auth/server/session.ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  clearTokenCookies,
  getTokensFromCookies,
  isTokenValid,
  setTokenCookies,
} from "../core";
import type { Session, SessionUser } from "../types";
import { getGlobalAuthConfig } from "../config";

/**
 * Module-level cached resolver. React's `cache()` deduplicates this per request,
 * so calling `getSession()` multiple times in one render tree costs exactly one
 * cookie read and one adapter.fetchUser() call.
 */
const resolveSession = cache(async (): Promise<Session | null> => {
  const config = getGlobalAuthConfig();
  const tokens = await getTokensFromCookies(config);
  if (!tokens) return null;

  let { accessToken, refreshToken } = tokens;

  // Access token is expired — attempt a silent refresh
  if (!isTokenValid(accessToken)) {
    if (!isTokenValid(refreshToken)) {
      // Both tokens are invalid — clear cookies and return no session
      await clearTokenCookies(config);
      return null;
    }

    try {
      const refreshed = await config.adapter.refreshToken(refreshToken);
      await setTokenCookies(refreshed, config);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
    } catch {
      // Refresh failed — clear cookies so the user is asked to log in again
      await clearTokenCookies(config);
      return null;
    }
  }

  try {
    const user = await config.adapter.fetchUser(accessToken);
    return { accessToken, refreshToken, user };
  } catch {
    // fetchUser failed — return null but don't clear cookies (might be transient)
    return null;
  }
});

/**
 * Returns the current session, or null if the user is not authenticated.
 * Safe to call in any Server Component, layout, or server action.
 * Results are deduplicated per request via React cache().
 */
export async function getSession(): Promise<Session | null> {
  return resolveSession();
}

/**
 * Returns the current access token, or null if not authenticated.
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await resolveSession();
  return session?.accessToken ?? null;
}

/**
 * Returns the current refresh token, or null if not authenticated.
 */
export async function getRefreshToken(): Promise<string | null> {
  const session = await resolveSession();
  return session?.refreshToken ?? null;
}

/**
 * Returns the current user, or null if not authenticated.
 */
export async function getUser(): Promise<SessionUser | null> {
  const session = await resolveSession();
  return session?.user ?? null;
}

/**
 * Returns the current session, or redirects to the sign-in page if not authenticated.
 * Use this as a server-side guard in protected pages and layouts.
 *
 * @example
 * // app/dashboard/page.tsx
 * const session = await auth.requireSession();
 * // session is guaranteed non-null here
 */
export async function requireSession(
  options: { includeCallbackUrl?: boolean } = {},
): Promise<Session> {
  const { includeCallbackUrl = true } = options;
  const config = getGlobalAuthConfig();
  const session = await resolveSession();

  if (!session) {
    if (includeCallbackUrl) {
      try {
        const headersList = await headers();
        const currentPath =
          headersList.get("x-pathname") ??
          headersList.get("x-invoke-path") ??
          "";
        if (currentPath) {
          redirect(
            `${config.pages.signIn}?callbackUrl=${encodeURIComponent(currentPath)}`,
          );
        }
      } catch (error) {
        if (isRedirectError(error)) throw error;
      }
    }
    redirect(config.pages.signIn);
  }

  return session;
}

/** Checks if an error is the special NEXT_REDIRECT internal error. */
function isRedirectError(error: unknown): boolean {
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
