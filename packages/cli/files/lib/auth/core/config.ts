import type {
  AuthConfig,
  AuthPages,
  CookieOptions,
  ResolvedAuthConfig,
  ResolvedCookieNames,
} from "../types";

const DEFAULT_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  domain: undefined as string | undefined,
};

const DEFAULT_PAGES: Required<AuthPages> = {
  signIn: "/login",
  afterSignIn: "/",
  afterSignOut: "/",
};

const DEFAULT_REFRESH_THRESHOLD_SECONDS = 120;
const DEFAULT_COOKIE_BASE_NAME = "auth-session";

function resolveCookieNames(
  cookieOptions?: CookieOptions,
): ResolvedCookieNames {
  const baseName = cookieOptions?.name ?? DEFAULT_COOKIE_BASE_NAME;
  return {
    accessToken: `${baseName}.access`,
    refreshToken: `${baseName}.refresh`,
  };
}

/**
 * Merges the user-provided config with defaults and returns a fully
 * resolved config object that every internal module can rely on.
 */
export function createAuthConfig(config: AuthConfig): ResolvedAuthConfig {
  return {
    adapter: config.adapter,
    cookieNames: resolveCookieNames(config.cookies),
    cookieOptions: {
      secure: config.cookies?.secure ?? DEFAULT_COOKIE_OPTIONS.secure,
      sameSite: config.cookies?.sameSite ?? DEFAULT_COOKIE_OPTIONS.sameSite,
      path: config.cookies?.path ?? DEFAULT_COOKIE_OPTIONS.path,
      domain: config.cookies?.domain ?? DEFAULT_COOKIE_OPTIONS.domain,
    },
    refreshThresholdSeconds:
      config.refresh?.refreshThresholdSeconds ??
      DEFAULT_REFRESH_THRESHOLD_SECONDS,
    pages: {
      signIn: config.pages?.signIn ?? DEFAULT_PAGES.signIn,
      afterSignIn: config.pages?.afterSignIn ?? DEFAULT_PAGES.afterSignIn,
      afterSignOut: config.pages?.afterSignOut ?? DEFAULT_PAGES.afterSignOut,
    },
    debug: config.debug ?? false,
  };
}
