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
 * @example
 * const getProfile = auth.createSessionFetcher(
 *   async (session, userId: string) => {
 *     return fetchProfile(session.accessToken, userId);
 *   }
 * );
 *
 * // In a Server Component:
 * const profile = await getProfile(userId);
 */
export function createSessionFetcher<TData, TArgs extends unknown[]>(
  fetcher: (session: Session, ...args: TArgs) => Promise<TData>,
  options: { required?: boolean } = { required: true },
): (...args: TArgs) => Promise<TData | null> {
  return async (...args: TArgs): Promise<TData | null> => {
    const config = getGlobalAuthConfig();
    const session = await getSession();

    if (!session) {
      if (options.required !== false) redirect(config.pages.signIn);
      return null;
    }

    return fetcher(session, ...args);
  };
}
