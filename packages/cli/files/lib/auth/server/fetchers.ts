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

