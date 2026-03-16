import { cookies } from "next/headers";
import type { ResolvedAuthConfig, TokenPair } from "../types";
import { getTokenExpiry } from "./jwt";

/**
 * Writes both access and refresh token cookies to the response.
 * Each cookie's `maxAge` is derived from the token's own `exp` claim.
 * Both cookies are set with `httpOnly: true` to prevent client-side access.
 * Called after login and token refresh.
 *
 * @param tokens - The access and refresh token pair to persist.
 * @param config - The resolved auth configuration.
 */
export async function setTokenCookies(
  tokens: TokenPair,
  config: ResolvedAuthConfig,
): Promise<void> {
  const cookieStore = await cookies();

  const accessExpiry = getTokenExpiry(tokens.accessToken);
  const refreshExpiry = getTokenExpiry(tokens.refreshToken);

  const baseOptions = {
    httpOnly: true,
    secure: config.cookieOptions.secure,
    sameSite: config.cookieOptions.sameSite,
    path: config.cookieOptions.path,
    ...(config.cookieOptions.domain
      ? { domain: config.cookieOptions.domain }
      : {}),
  };

  cookieStore.set(config.cookieNames.accessToken, tokens.accessToken, {
    ...baseOptions,
    ...(accessExpiry && !accessExpiry.isExpired
      ? { maxAge: accessExpiry.maxAgeSeconds }
      : {}),
  });

  cookieStore.set(config.cookieNames.refreshToken, tokens.refreshToken, {
    ...baseOptions,
    ...(refreshExpiry && !refreshExpiry.isExpired
      ? { maxAge: refreshExpiry.maxAgeSeconds }
      : {}),
  });
}

/**
 * Reads the token pair from cookies.
 *
 * @param config - The resolved auth configuration.
 * @returns The token pair, or `null` if either token cookie is absent.
 */
export async function getTokensFromCookies(
  config: ResolvedAuthConfig,
): Promise<TokenPair | null> {
  const cookieStore = await cookies();

  const accessToken = cookieStore.get(config.cookieNames.accessToken)?.value;
  const refreshToken = cookieStore.get(config.cookieNames.refreshToken)?.value;

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/**
 * Deletes both token cookies, effectively ending the session.
 *
 * @param config - The resolved auth configuration.
 */
export async function clearTokenCookies(
  config: ResolvedAuthConfig,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(config.cookieNames.accessToken);
  cookieStore.delete(config.cookieNames.refreshToken);
}

/**
 * Updates only the access token cookie.
 * Used during silent refresh when only the access token changes.
 * The cookie is set with `httpOnly: true`.
 *
 * @param accessToken - The new access token value to store.
 * @param config - The resolved auth configuration.
 */
export async function updateAccessTokenCookie(
  accessToken: string,
  config: ResolvedAuthConfig,
): Promise<void> {
  const cookieStore = await cookies();
  const expiry = getTokenExpiry(accessToken);

  cookieStore.set(config.cookieNames.accessToken, accessToken, {
    httpOnly: true,
    secure: config.cookieOptions.secure,
    sameSite: config.cookieOptions.sameSite,
    path: config.cookieOptions.path,
    ...(config.cookieOptions.domain
      ? { domain: config.cookieOptions.domain }
      : {}),
    ...(expiry && !expiry.isExpired ? { maxAge: expiry.maxAgeSeconds } : {}),
  });
}
