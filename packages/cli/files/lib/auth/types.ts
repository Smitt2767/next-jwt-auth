import { z } from "zod";
import type {
  fetchSessionAction,
  loginAction,
  logoutAction,
  refreshSessionAction,
} from "./server";

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
  /** The sign-in page path. Defaults to "/login". */
  signIn?: string;
  /** Where to redirect after successful login. Defaults to "/dashboard". */
  afterSignIn?: string;
  /** Where to redirect after logout. Defaults to "/". */
  afterSignOut?: string;
}

export interface AuthConfig {
  adapter: AuthAdapter;
  cookies?: CookieOptions;
  refresh?: RefreshOptions;
  pages?: AuthPages;
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
}

// ─── Client Session ───────────────────────────────────────────────────────────

export type SessionStatus = "authenticated" | "unauthenticated";

/**
 * The discriminated union returned by useSession().
 * Check session.status before accessing session.user / session.accessToken.
 *
 * Loading state is intentionally omitted — pass `initialSession` from your
 * root layout Server Component to hydrate state without a loading phase.
 */
export type ClientSession =
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

/** The server actions object passed to <AuthProvider actions={...}>. */
export type AuthActions = {
  login: typeof loginAction;
  logout: typeof logoutAction;
  refresh: typeof refreshSessionAction;
  revalidateSession: typeof fetchSessionAction;
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
    required_error: "JWT payload is missing the required `exp` claim",
  }),
  iat: z.number().optional(),
  sub: z.string().optional(),
});
