// lib/auth/server/fetchers.ts
import { redirect } from "next/navigation";
import type { Session } from "../types";
import { getSession } from "./session";
import { getGlobalAuthConfig } from "../config";

/**
 * Runs a callback with the current session if one exists.
 * Returns null (or the provided defaultValue) if the user is not authenticated.
 *
 * @example
 * const data = await auth.withSession((session) => fetchUserData(session.accessToken));
 */
export async function withSession<TResult>(
  callback: (session: Session) => TResult | Promise<TResult>,
  defaultValue?: TResult,
): Promise<TResult | null> {
  const session = await getSession();
  if (!session) {
    return defaultValue !== undefined ? defaultValue : null;
  }
  return callback(session);
}

/**
 * Runs a callback with the current session, or redirects to the sign-in page.
 * Use in Server Components or server actions where authentication is required.
 *
 * @example
 * const data = await auth.withRequiredSession((session) => fetchProfile(session.user.id));
 */
export async function withRequiredSession<TResult>(
  callback: (session: Session) => TResult | Promise<TResult>,
): Promise<TResult> {
  const config = getGlobalAuthConfig();
  const session = await getSession();
  if (!session) redirect(config.pages.signIn);
  return callback(session);
}

/**
 * Creates a reusable data-fetching function that automatically receives
 * the current session as its first argument.
 *
 * The `required` option controls what happens when there is no active session:
 *   - `true` (default) — redirects to the sign-in page.
 *   - `false`          — returns null, letting the caller decide what to do.
 *
 * The default is intentionally `true` so callers who don't pass any options
 * get the safe, protected behaviour. You must explicitly opt out with
 * `{ required: false }` to get nullable behaviour.
 *
 * @example
 * // Protected fetcher — redirects if unauthenticated (default)
 * const getProfile = auth.createSessionFetcher(
 *   async (session, userId: string) => fetchProfile(session.accessToken, userId),
 * );
 *
 * // Optional fetcher — returns null if unauthenticated
 * const getProfile = auth.createSessionFetcher(
 *   async (session, userId: string) => fetchProfile(session.accessToken, userId),
 *   { required: false },
 * );
 *
 * // In a Server Component:
 * const profile = await getProfile(userId);
 */
export function createSessionFetcher<TData, TArgs extends unknown[]>(
  fetcher: (session: Session, ...args: TArgs) => Promise<TData>,
  options?: { required?: boolean },
): (...args: TArgs) => Promise<TData | null> {
  // Resolve intent explicitly: treat anything other than a deliberate `false` as required.
  // This means `undefined` (no options), `{}` (empty object), and `{ required: true }` all
  // redirect on missing session — only `{ required: false }` opts out.
  const isRequired = options?.required !== false;

  return async (...args: TArgs): Promise<TData | null> => {
    const config = getGlobalAuthConfig();
    const session = await getSession();

    if (!session) {
      if (isRequired) redirect(config.pages.signIn);
      return null;
    }

    return fetcher(session, ...args);
  };
}
