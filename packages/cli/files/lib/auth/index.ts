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
import { withSession, withRequiredSession } from "./server/fetchers";
import {
  createAuthMiddleware,
  matchesPath,
} from "./middleware/auth-middleware";
import { fetchSessionAction, loginAction, logoutAction, updateSessionTokenAction } from "./server/actions";
import { createOAuthHandler } from "./handlers";

/**
 * Initializes the auth library with your adapter and configuration.
 *
 * Call this once in `auth.ts` at your project root. The resolved config is
 * stored in a module-level singleton so every internal module can access it
 * without prop drilling.
 *
 * @param config - Your auth configuration: adapter (required), plus optional
 *   cookies, refresh, pages, debug, and providers settings.
 * @returns An object containing:
 *   - `getSession`, `getUser`, `getAccessToken`, `getRefreshToken`, `requireSession` — server session helpers
 *   - `withSession`, `withRequiredSession` — fetch utilities
 *   - `createMiddleware`, `matchesPath` — middleware factory and path matcher
 *   - `handlers` — `{ GET }` for the OAuth catch-all route handler
 *   - `config` — the resolved configuration object
 *   - `actions` — bundled server actions to pass to `<AuthProvider>`
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
    // ── Middleware ─────────────────────────────────────────────────────────
    /** Returns a middleware resolver function for use in middleware.ts. */
    createMiddleware: () => createAuthMiddleware(),
    /** Returns true if pathname matches any of the given path patterns. */
    matchesPath,

    // ── OAuth Route Handlers ───────────────────────────────────────────────
    /**
     * Next.js Route Handler for OAuth flows.
     * Export as `export const { GET } = auth.handlers` in your catch-all route:
     *   `app/api/auth/[...oauth]/route.ts`
     *
     * Handles `/api/auth/[provider]/login` and `/api/auth/[provider]/callback`.
     * Before OAuth is configured this handler throws — run
     * `npx @smittdev/next-jwt-auth add oauth` to replace it with the real implementation.
     */
    handlers: {
      GET: createOAuthHandler(),
    },

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
      fetchSession: fetchSessionAction,
      updateSessionToken: updateSessionTokenAction,
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
  OAuthUserInfo,
  OAuthProvider,
  OAuthProviderId,
} from "./types";
