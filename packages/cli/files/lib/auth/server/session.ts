// lib/auth/server/session.ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTokensFromCookies, isTokenValid } from "../core";
import type { Session, SessionUser } from "../types";
import { getGlobalAuthConfig } from "../config";

/**
 * Module-level cached resolver. React's `cache()` deduplicates this per request,
 * so calling `getSession()` multiple times in one render tree costs exactly one
 * cookie read and one adapter.fetchUser() call.
 *
 * Intentionally does NOT refresh tokens or write cookies — that is handled by
 * the middleware before the request reaches this point. Attempting to set cookies
 * during page rendering throws in Next.js (only allowed in Server Actions /
 * Route Handlers).
 */
const resolveSession = cache(async (): Promise<Session | null> => {
  const config = getGlobalAuthConfig();
  const tokens = await getTokensFromCookies(config);
  if (!tokens) return null;

  const { accessToken, refreshToken } = tokens;

  // If the access token is invalid here, the middleware either could not refresh
  // (e.g. refresh token also expired) or is not running on this route.
  // Either way, treat it as no session — do not attempt to set cookies.
  if (!isTokenValid(accessToken)) return null;

  try {
    const user = await config.adapter.fetchUser(accessToken);
    return { accessToken, refreshToken, user };
  } catch {
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
 * Returns the current access token directly from cookies.
 * Does NOT call fetchUser — use getSession() if you need the full session.
 */
export async function getAccessToken(): Promise<string | null> {
  const config = getGlobalAuthConfig();
  const tokens = await getTokensFromCookies(config);
  if (!tokens || !isTokenValid(tokens.accessToken)) return null;
  return tokens.accessToken;
}

/**
 * Returns the current refresh token directly from cookies.
 * Does NOT call fetchUser — use getSession() if you need the full session.
 */
export async function getRefreshToken(): Promise<string | null> {
  const config = getGlobalAuthConfig();
  const tokens = await getTokensFromCookies(config);
  return tokens?.refreshToken ?? null;
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
