import { z } from "zod";
import type { fetchSessionAction, loginAction, logoutAction } from "./server";

// ─── Core Domain Types ────────────────────────────────────────────────────────

/**
 * The user object stored in the session.
 * Extend this interface via module augmentation in your auth.ts to add
 * custom fields (name, role, avatarUrl, etc.):
 *
 *   declare module "@/lib/auth" {
 *     interface SessionUser {
 *       name: string;
 *       role: "admin" | "user";
 *     }
 *   }
 */
export interface SessionUser {
  id: string;
  email: string;
}

/** The shape of a decoded JWT payload. We only require `exp`. */
export interface TokenPayload {
  exp: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

/** An access + refresh token pair returned by login or refresh operations. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** A fully resolved server-side session. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * The adapter you implement in auth.ts.
 * Three functions are required; logout is optional.
 */
export interface AuthAdapter {
  /** Authenticate with credentials, return a token pair or throw. */
  login(credentials: Record<string, unknown>): Promise<TokenPair>;
  /** Exchange a refresh token for a new token pair or throw. */
  refreshToken(refreshToken: string): Promise<TokenPair>;
  /** Fetch the user object for a given access token or throw. */
  fetchUser(accessToken: string): Promise<SessionUser>;
  /** Optional: invalidate the refresh token server-side on logout. */
  logout?(tokens: TokenPair): Promise<void>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CookieOptions {
  /** Base name for cookies. Defaults to "auth-session". */
  name?: string;
  /** Defaults to true in production, false in development. */
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  domain?: string;
  path?: string;
}

export interface RefreshOptions {
  /**
   * Access tokens with less than this many seconds remaining will be
   * silently refreshed. Defaults to 120 (2 minutes).
   */
  refreshThresholdSeconds?: number;
}

export interface AuthPages {
  /** The sign-in page path. Defaults to "/login". Also used as the post-logout redirect. */
  signIn?: string;
  /** Where to redirect after successful login. Defaults to "/". */
  home?: string;
}

export interface AuthConfig {
  adapter: AuthAdapter;
  cookies?: CookieOptions;
  refresh?: RefreshOptions;
  pages?: AuthPages;
  /**
   * Enable verbose debug logging to the console.
   * Logs token refresh decisions, session resolution, middleware activity,
   * and action outcomes. Should only be enabled in development.
   *
   * @example
   * debug: process.env.NODE_ENV === "development",
   */
  debug?: boolean;
}

// ─── Resolved Config (internal) ──────────────────────────────────────────────

export interface ResolvedCookieNames {
  accessToken: string;
  refreshToken: string;
}

export interface ResolvedAuthConfig {
  adapter: AuthAdapter;
  cookieNames: ResolvedCookieNames;
  cookieOptions: Required<Omit<CookieOptions, "name" | "domain">> & {
    domain?: string;
  };
  refreshThresholdSeconds: number;
  pages: Required<AuthPages>;
  /** Whether debug logging is enabled. */
  debug: boolean;
}

// ─── Client Session ───────────────────────────────────────────────────────────

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * The discriminated union returned by useSession().
 * Check session.status before accessing session.user / session.accessToken.
 *
 * - "loading"         — initial state when no `initialSession` prop was passed.
 *                       The provider is fetching the session from the server on mount.
 * - "authenticated"   — a valid session exists.
 * - "unauthenticated" — no session. Either `initialSession={null}` was passed
 *                       explicitly, or the mount fetch returned no session.
 *
 * To avoid the loading state entirely, pass `initialSession` from your root
 * layout Server Component — the client will hydrate instantly with no fetch.
 */
export type ClientSession =
  | {
      status: "loading";
      user: null;
      accessToken: null;
      refreshToken: null;
    }
  | {
      status: "authenticated";
      user: SessionUser;
      accessToken: string;
      refreshToken: string;
    }
  | {
      status: "unauthenticated";
      user: null;
      accessToken: null;
      refreshToken: null;
    };

// ─── Action Results ───────────────────────────────────────────────────────────

/** The standard result shape for all Server Actions in this library. */
export type ActionResult<TData> =
  | { success: true; data: TData }
  | { success: false; error: string };

export type SessionActionData = Session;

/**
 * Options accepted by the login Server Action.
 * All fields are optional — login works with no options, defaulting to a
 * redirect to `pages.home`.
 */
export interface LoginActionOptions {
  /**
   * Whether to redirect after a successful login. Defaults to true.
   * Set to false to handle navigation yourself on the client.
   */
  redirect?: boolean;
  /**
   * Explicit redirect destination after login. Takes priority over callbackUrl
   * and pages.home.
   */
  redirectTo?: string;
  /**
   * A relative path to redirect to after login — typically read from the
   * `?callbackUrl=` search param set by requireSession().
   * Must start with "/" to prevent open-redirect attacks; invalid values
   * are silently ignored and fall back to pages.home.
   */
  callbackUrl?: string;
}

/** The server actions object passed to <AuthProvider actions={...}>. */
export type AuthActions = {
  login: typeof loginAction;
  logout: typeof logoutAction;
  fetchSession: typeof fetchSessionAction;
};

// ─── Zod Schemas (runtime validation) ────────────────────────────────────────

export const TokenPairSchema = z.object({
  accessToken: z
    .string()
    .min(1, "accessToken must be a non-empty string")
    .refine(
      (token) => token.split(".").length === 3,
      "accessToken does not appear to be a valid JWT (expected 3 dot-separated segments)",
    ),
  refreshToken: z
    .string()
    .min(1, "refreshToken must be a non-empty string")
    .refine(
      (token) => token.split(".").length === 3,
      "refreshToken does not appear to be a valid JWT (expected 3 dot-separated segments)",
    ),
});

export const TokenPayloadSchema = z.object({
  exp: z.number({
    error: "JWT payload is missing the required `exp` claim",
  }),
  iat: z.number().optional(),
  sub: z.string().optional(),
});
