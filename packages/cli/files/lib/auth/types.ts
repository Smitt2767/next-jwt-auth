import { z } from "zod";
import type { fetchSessionAction, loginAction, logoutAction, updateSessionTokenAction } from "./server/actions";

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

// ─── OAuth ────────────────────────────────────────────────────────────────────

/**
 * Union of all supported OAuth provider IDs.
 * Used as the first argument to `adapter.oauthLogin()` and as the `id` field
 * on every `OAuthProvider` subclass.
 */
export type OAuthProviderId = "google" | "github";

/**
 * Normalized user profile returned by any OAuth provider after successful auth.
 * Passed directly to `adapter.oauthLogin()` for you to exchange for your own JWT.
 */
export interface OAuthUserInfo {
  /** Unique user ID from the provider (e.g. Google's `sub`, GitHub's numeric ID). */
  id: string;
  /** User's email address. Always present — providers without email are rejected. */
  email: string;
  /** Display name, if the provider returns one. */
  name?: string;
  /** Avatar URL, if the provider returns one. */
  picture?: string;
  /** Full raw provider response — use for any extra fields you need. */
  raw: Record<string, unknown>;
}

/**
 * Structural interface for OAuth providers.
 * Satisfied by `GoogleProvider`, `GitHubProvider`, and any custom `OAuthProvider` subclass.
 * Available after running `npx @smittdev/next-jwt-auth add oauth`.
 */
export interface OAuthProvider {
  readonly id: OAuthProviderId;
  readonly name: string;
  getAuthorizationUrl(params: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }): string;
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<{ accessToken: string }>;
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * The adapter you implement in auth.ts.
 * Three functions are required; logout and oauthLogin are optional.
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
  /**
   * Optional: called after a successful OAuth callback to exchange the provider's
   * user profile for your own JWT tokens. Required when using OAuth providers.
   *
   * @param provider            - The provider id ("google" | "github")
   * @param userInfo            - Normalized user profile from the provider
   * @param providerAccessToken - The raw access token issued by the OAuth provider.
   *                              Forward this to your backend if it needs to make
   *                              provider API calls on the user's behalf.
   * @returns Your own { accessToken, refreshToken } pair or throw on failure
   */
  oauthLogin?(
    provider: OAuthProviderId,
    userInfo: OAuthUserInfo,
    providerAccessToken: string,
  ): Promise<TokenPair>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Options for customizing the session cookies set by this library.
 * All fields are optional — sensible defaults are applied automatically.
 */
export interface CookieOptions {
  /** Base name for cookies. Defaults to "auth-session". */
  name?: string;
  /** Defaults to true in production, false in development. */
  secure?: boolean;
  /** Controls cross-site request behaviour. Defaults to "lax". */
  sameSite?: "strict" | "lax" | "none";
  /** Restricts cookies to a specific domain (e.g. ".example.com" for subdomains). Omitted by default. */
  domain?: string;
  /** Restricts cookies to a URL path prefix. Defaults to "/". */
  path?: string;
}

/**
 * Options for controlling the automatic token-refresh behaviour in the middleware.
 */
export interface RefreshOptions {
  /**
   * Access tokens with less than this many seconds remaining will be
   * silently refreshed. Defaults to 120 (2 minutes).
   */
  refreshThresholdSeconds?: number;
}

/**
 * Page paths used for redirects by session guards and logout.
 * All fields are optional — defaults are applied if omitted.
 */
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
  /**
   * OAuth provider instances. Add providers after running:
   *   npx @smittdev/next-jwt-auth add oauth
   *
   * @example
   * import { GoogleProvider, GitHubProvider } from "@/lib/auth/providers";
   *
   * providers: [
   *   new GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }),
   *   new GitHubProvider({ clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }),
   * ],
   */
  providers?: OAuthProvider[];
}

// ─── Resolved Config (internal) ──────────────────────────────────────────────

/** Fully-resolved cookie names derived from `CookieOptions.name`. Internal use only. */
export interface ResolvedCookieNames {
  accessToken: string;
  refreshToken: string;
}

/**
 * Fully resolved internal auth configuration.
 * Produced by `createAuthConfig()` and stored in the module-level singleton.
 * Internal use only — consume via `getGlobalAuthConfig()`.
 */
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
  /** Registered OAuth providers (empty array when not configured). */
  providers: OAuthProvider[];
}

// ─── Client Session ───────────────────────────────────────────────────────────

/**
 * The three possible states of a client-side authentication session.
 * - `"loading"`         — session check in progress; no `initialSession` was passed to `<AuthProvider>`.
 * - `"authenticated"`   — a valid session exists.
 * - `"unauthenticated"` — no session; either `initialSession={null}` was passed or the fetch returned nothing.
 */
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
   * Where to redirect after a successful login.
   * Must start with "/" to prevent open-redirect attacks; invalid values
   * are silently ignored and fall back to pages.home.
   * Typically read from the `?callbackUrl=` search param set by requireSession().
   */
  callbackUrl?: string;
}

/** The server actions object passed to <AuthProvider actions={...}>. */
export type AuthActions = {
  login: typeof loginAction;
  logout: typeof logoutAction;
  fetchSession: typeof fetchSessionAction;
  updateSessionToken: typeof updateSessionTokenAction;
};

// ─── Zod Schemas (runtime validation) ────────────────────────────────────────

/**
 * Zod schema for runtime validation of access + refresh token pairs.
 * Both tokens must be non-empty strings with exactly 3 dot-separated JWT segments.
 * Used internally by action handlers to catch malformed adapter responses early.
 */
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

/**
 * Zod schema for validating a decoded JWT payload.
 * Requires the `exp` claim (expiry timestamp in seconds); `iat` and `sub` are optional.
 */
export const TokenPayloadSchema = z.object({
  exp: z.number({
    error: "JWT payload is missing the required `exp` claim",
  }),
  iat: z.number().optional(),
  sub: z.string().optional(),
});
