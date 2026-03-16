import { NextRequest, NextResponse } from "next/server";
import { getSecondsUntilExpiry, isTokenValid } from "../core/jwt";
import { getGlobalAuthConfig, debugLog } from "../config";

export interface AuthMiddlewareResult {
  /** True if the request has a valid, non-expired access token. */
  isAuthenticated: boolean;
  /** The current access token (may be a freshly rotated one). */
  accessToken: string | null;
  /** The current refresh token (may be a freshly rotated one). */
  refreshToken: string | null;
  /**
   * Wraps a NextResponse, writing any refreshed token cookies onto it.
   * Always use this instead of returning the response directly.
   *
   * @example
   * return session.response(NextResponse.next());
   * return session.response(NextResponse.redirect(url));
   */
  response: (base: NextResponse) => NextResponse;
  /**
   * Redirects to a URL and clears the session cookies.
   * Use this when redirecting unauthenticated users to the login page.
   *
   * @example
   * return session.redirect(new URL("/login", request.url));
   */
  redirect: (url: URL) => NextResponse;
}

/**
 * Converts a path pattern string to a regular expression.
 * Supports `:param` (single segment) and `:path*` (zero-or-more segments) wildcards.
 *
 * @param pattern - A path pattern string (e.g. `"/dashboard/:path*"`, `"/user/:id"`).
 * @returns A regular expression that matches URLs following the pattern.
 *
 * @example
 * // "/dashboard/:path*"  → matches /dashboard, /dashboard/settings, etc.
 * // "/user/:id"          → matches /user/123 but not /user/123/profile
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/:[\w]+\*/g, "(?:/.*)?")
    .replace(/:[\w]+\*/g, ".*")
    .replace(/:[\w]+/g, "[^/]+");
  return new RegExp(`^${escaped}\\/?$`);
}

/**
 * Returns `true` if `pathname` matches any of the provided path patterns.
 *
 * @param pathname - The URL pathname to test (e.g. `"/dashboard/settings"`).
 * @param patterns - An array of path patterns to match against (supports `:param` and `:path*` wildcards).
 * @returns `true` if the pathname matches at least one pattern; `false` otherwise.
 *
 * @example
 * auth.matchesPath("/dashboard/settings", ["/dashboard/:path*"]) // true
 * auth.matchesPath("/login", ["/", "/login"])                    // true
 */
export function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => patternToRegex(pattern).test(pathname));
}

function writeTokensToResponse(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  const config = getGlobalAuthConfig();
  const accessExpiry = getSecondsUntilExpiry(accessToken);
  const refreshExpiry = getSecondsUntilExpiry(refreshToken);

  const baseOptions = {
    httpOnly: true,
    secure: config.cookieOptions.secure,
    sameSite: config.cookieOptions.sameSite as "strict" | "lax" | "none",
    path: config.cookieOptions.path,
    ...(config.cookieOptions.domain
      ? { domain: config.cookieOptions.domain }
      : {}),
  };

  response.cookies.set(config.cookieNames.accessToken, accessToken, {
    ...baseOptions,
    ...(accessExpiry > 0 ? { maxAge: accessExpiry } : {}),
  });

  response.cookies.set(config.cookieNames.refreshToken, refreshToken, {
    ...baseOptions,
    ...(refreshExpiry > 0 ? { maxAge: refreshExpiry } : {}),
  });
}

function clearTokensFromResponse(response: NextResponse): void {
  const config = getGlobalAuthConfig();
  response.cookies.set(config.cookieNames.accessToken, "", { maxAge: 0 });
  response.cookies.set(config.cookieNames.refreshToken, "", { maxAge: 0 });
}

/**
 * Returns an async middleware resolver function.
 * Call this once per middleware invocation to get the session state.
 *
 * The resolver automatically handles token refresh — if the access token
 * is expired or close to expiry, it calls `adapter.refreshToken()` and
 * returns the new tokens. Always use `session.response()` to write them to cookies.
 *
 * @returns An async function `(request: NextRequest) => Promise<AuthMiddlewareResult>`.
 *
 * @example
 * // middleware.ts
 * const resolveAuth = auth.createMiddleware();
 * const session = await resolveAuth(request);
 * if (!session.isAuthenticated) return session.redirect(new URL("/login", request.url));
 * return session.response(NextResponse.next());
 */
export function createAuthMiddleware() {
  return async function resolveAuth(
    request: NextRequest,
  ): Promise<AuthMiddlewareResult> {
    const config = getGlobalAuthConfig();
    const { pathname } = request.nextUrl;

    let accessToken =
      request.cookies.get(config.cookieNames.accessToken)?.value ?? null;
    const refreshToken =
      request.cookies.get(config.cookieNames.refreshToken)?.value ?? null;

    let refreshedTokens: { accessToken: string; refreshToken: string } | null =
      null;

    if (!accessToken && !refreshToken) {
      debugLog("Middleware: no tokens found", { pathname });
    }

    // Refresh if: no access token, expired, or within the refresh threshold
    const secondsRemaining = accessToken
      ? getSecondsUntilExpiry(accessToken)
      : 0;
    const needsRefresh =
      !accessToken ||
      !isTokenValid(accessToken) ||
      secondsRemaining <= config.refreshThresholdSeconds;

    if (needsRefresh && refreshToken && isTokenValid(refreshToken)) {
      debugLog("Middleware: access token needs refresh — attempting", {
        pathname,
        reason: !accessToken
          ? "no access token"
          : !isTokenValid(accessToken)
            ? "access token expired"
            : `within threshold (${secondsRemaining}s remaining)`,
      });

      try {
        refreshedTokens = await config.adapter.refreshToken(refreshToken);
        accessToken = refreshedTokens.accessToken;
        debugLog("Middleware: token refresh successful", { pathname });
      } catch (error) {
        // Refresh failed — proceed with the existing (potentially expired) token state
        debugLog(
          "Middleware: token refresh failed — proceeding with existing state",
          {
            pathname,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const isAuthenticated = accessToken ? isTokenValid(accessToken) : false;

    debugLog("Middleware: resolved", { pathname, isAuthenticated });

    function response(base: NextResponse): NextResponse {
      if (refreshedTokens) {
        writeTokensToResponse(
          base,
          refreshedTokens.accessToken,
          refreshedTokens.refreshToken,
        );
      }
      return base;
    }

    function redirect(url: URL): NextResponse {
      debugLog("Middleware: redirecting and clearing session cookies", {
        pathname,
        destination: url.pathname,
      });
      const redirectResponse = NextResponse.redirect(url);
      clearTokensFromResponse(redirectResponse);
      return redirectResponse;
    }

    return {
      isAuthenticated,
      accessToken,
      refreshToken: refreshedTokens?.refreshToken ?? refreshToken,
      response,
      redirect,
    };
  };
}
