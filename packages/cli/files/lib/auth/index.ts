// lib/auth/index.ts
//
// ⚠️  SERVER-ONLY — DO NOT IMPORT THIS FILE IN CLIENT COMPONENTS
//
// This is the main entry point for the library. It exports the Auth() factory
// and all server-side utilities. Client-side usage goes through:
//   import { AuthProvider, useSession, useAuth } from "@/lib/auth/client"

import type { AuthActions, AuthConfig } from "./types";
import { createAuthConfig } from "./core/config";
import { setGlobalAuthConfig } from "./config";
import {
  getSession,
  getUser,
  getAccessToken,
  getRefreshToken,
  requireSession,
} from "./server/session";
import {
  withSession,
  withRequiredSession,
  createSessionFetcher,
} from "./server/fetchers";
import {
  createAuthMiddleware,
  matchesPath,
} from "./middleware/auth-middleware";
import {
  fetchSessionAction,
  loginAction,
  logoutAction,
  refreshSessionAction,
} from "./server/actions";

/**
 * Initializes the auth library with your adapter and configuration.
 *
 * Call this once in `auth.ts` at your project root. The resolved config is
 * stored in a module-level singleton so every internal module can access it
 * without prop drilling.
 *
 * @example
 * // auth.ts
 * import { Auth } from "@/lib/auth";
 *
 * export const auth = Auth({
 *   adapter: {
 *     async login(credentials) { ... },
 *     async refreshToken(token) { ... },
 *     async fetchUser(accessToken) { ... },
 *   },
 *   debug: process.env.NODE_ENV === "development",
 * });
 */
export function Auth(config: AuthConfig) {
  const resolved = createAuthConfig(config);

  // Store in the module-level singleton — every internal call to
  // getGlobalAuthConfig() will return this resolved config.
  setGlobalAuthConfig(resolved);

  return {
    // ── Server-side session helpers ────────────────────────────────────────
    /** Returns the current session, or null if unauthenticated. */
    getSession,
    /** Returns the current user, or null if unauthenticated. */
    getUser,
    /** Returns the current access token, or null if unauthenticated. */
    getAccessToken,
    /** Returns the current refresh token, or null if unauthenticated. */
    getRefreshToken,
    /** Returns the current session, or redirects to the sign-in page. */
    requireSession,

    // ── Fetch utilities ────────────────────────────────────────────────────
    /** Run a callback with the session if it exists, otherwise return null. */
    withSession,
    /** Run a callback with the session, or redirect to sign-in. */
    withRequiredSession,
    /** Create a reusable data-fetcher that receives the session automatically. */
    createSessionFetcher,

    // ── Middleware ─────────────────────────────────────────────────────────
    /** Returns a middleware resolver function for use in middleware.ts. */
    createMiddleware: () => createAuthMiddleware(),
    /** Returns true if pathname matches any of the given path patterns. */
    matchesPath,

    // ── Config ─────────────────────────────────────────────────────────────
    /** The resolved configuration object (rarely needed directly). */
    config: resolved,

    // ── Server Actions ─────────────────────────────────────────────────────
    // Bundled here so your root layout can pass them to <AuthProvider>.
    // Since auth.ts is imported by layout.tsx, the singleton is guaranteed
    // to be initialized before any of these actions ever run.
    actions: {
      login: loginAction,
      logout: logoutAction,
      refresh: refreshSessionAction,
      revalidateSession: fetchSessionAction,
    } satisfies AuthActions,
  };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
// These let consumers do:  import type { SessionUser } from "@/lib/auth"

export type {
  AuthConfig,
  AuthAdapter,
  AuthPages,
  CookieOptions,
  RefreshOptions,
  Session,
  SessionUser,
  TokenPair,
  ClientSession,
  SessionStatus,
  ActionResult,
  SessionActionData,
  AuthActions,
  LoginActionOptions,
} from "./types";
