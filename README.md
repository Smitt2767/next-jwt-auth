# @ss/next-jwt-auth

Zero-config JWT authentication scaffolder for Next.js App Router.

Run one command. Get a complete, production-ready auth system in your project — fully typed, fully yours.

```bash
npx @ss/next-jwt-auth init
```

---

## Why Not Auth.js?

Auth.js (NextAuth) is excellent for OAuth providers — Google, GitHub, and friends. But if your backend issues its own JWTs and you just need to wire them into Next.js, Auth.js becomes the wrong tool:

- **Credentials provider is intentionally limited.** Auth.js discourages credentials-based auth and actively restricts what you can do with it (no access to the raw response, opinionated session shape, no refresh token support out of the box).
- **You don't control the session.** Auth.js owns the session format. If your API returns a custom JWT with roles, expiry, or extra claims, you're fighting the library to expose them.
- **Refresh tokens are not a first-class concept.** Auth.js has no built-in dual-token (access + refresh) strategy. Handling short-lived access tokens with silent refresh requires hacks.
- **Magic and black boxes.** Auth.js abstracts away the cookie layer, the token layer, and the session layer. When something breaks, it's hard to know where to look.

This library takes the opposite approach: it scaffolds the plumbing into your project and gets out of the way. You implement three adapter functions, and you own everything from cookies to session shape. No lock-in, no magic, no fighting the framework.

---

## Philosophy

This is not an npm package you add as a dependency. It's a **code scaffolder** — like shadcn/ui, it copies a set of battle-tested TypeScript files into your project. You own the code from day one.

- No black boxes. No magic. Every line is in your codebase.
- Bring your own API. The library calls your adapter functions — you decide how tokens are issued and validated.
- No environment variables required. No secret keys managed by this library.
- Dual-token strategy (access + refresh) baked in.
- Full App Router support: Server Components, Server Actions, middleware, client hooks.

---

## Quick Start

### 1. Scaffold

```bash
npx @ss/next-jwt-auth init
```

You'll be asked:
- Where to place the library (default: `lib/auth/` or `src/lib/auth/`)
- Whether to generate `middleware.ts` (or `proxy.ts` for Next.js 16+)
- Whether to install `zod` (the only peer dependency)

### 2. Implement your adapter and configure

Open the generated `auth.ts` at your project root. Fill in the three required adapter functions and optionally tune the configuration:

```typescript
// auth.ts
import { Auth } from "@/lib/auth";

export const auth = Auth({
  // ── Adapter (required) ───────────────────────────────────────────────────
  // Three functions are required. They call your backend API — you decide the
  // shape of the request and response. The library only cares about the return
  // types: TokenPair ({ accessToken, refreshToken }) and SessionUser ({ id, email, ... }).

  adapter: {
    // Called by loginAction() with whatever credentials you pass from the client.
    async login(credentials) {
      const res = await fetch("https://your-api.com/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) throw new Error("Invalid credentials");
      return res.json(); // must return { accessToken, refreshToken }
    },

    // Called automatically by middleware and fetchSession when the access token
    // is expired or within the refresh threshold. Never called on the client.
    //
    // ⚠️  Race condition warning: if the user has multiple tabs open, two tabs
    // can call refreshToken() concurrently with the same refresh token. If your
    // backend uses rotate-on-use (single-use) refresh tokens, one request will
    // succeed and the other will receive a 401 — invalidating the session in
    // that tab. To handle this gracefully your backend should either:
    //   a) Accept the same refresh token within a short reuse window (~5s), or
    //   b) Return the same new token pair for duplicate in-flight requests.
    // If you use long-lived, multi-use refresh tokens this is not an issue.
    async refreshToken(refreshToken) {
      const res = await fetch("https://your-api.com/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) throw new Error("Session expired");
      return res.json(); // must return { accessToken, refreshToken }
    },

    // Called after login and during fetchSession to populate session.user.
    // Return whatever user fields your app needs — extend SessionUser below
    // via module augmentation to get full type safety.
    async fetchUser(accessToken) {
      const res = await fetch("https://your-api.com/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json(); // must return { id, email, ...any extra fields }
    },

    // Optional — called on logout to invalidate the refresh token server-side.
    // If omitted, logout still clears cookies locally but skips the API call.
    // Errors here are non-fatal — cookies are cleared regardless.
    async logout({ refreshToken }) {
      await fetch("https://your-api.com/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    },
  },

  // ── Cookies (optional) ───────────────────────────────────────────────────
  // All token cookies are httpOnly and never accessible to JavaScript.
  // The `name` value is used as a base — two cookies are created:
  //   <name>.access  — short-lived access token
  //   <name>.refresh — long-lived refresh token

  cookies: {
    name: "auth-session",          // default: "auth-session"
    secure: true,                  // default: true in production, false in development
    sameSite: "lax",               // default: "lax" — use "strict" for stricter CSRF protection
    path: "/",                     // default: "/"
    // domain: "example.com",      // optional — set for cross-subdomain sharing
  },

  // ── Token refresh (optional) ─────────────────────────────────────────────
  // Controls when the middleware proactively refreshes an access token before
  // it expires. If the token has less than `refreshThresholdSeconds` remaining,
  // the middleware calls adapter.refreshToken() and writes new cookies.

  refresh: {
    refreshThresholdSeconds: 60,   // default: 60 (refresh when < 60s remain on the access token)
    // Increase to e.g. 3600 to refresh proactively when < 1 hour remains on the access token.
  },

  // ── Pages (optional) ─────────────────────────────────────────────────────
  // Redirect targets used by requireSession(), loginAction(), and logoutAction().

  pages: {
    signIn: "/login",              // default: "/login"  — requireSession() + logoutAction() redirect here
    home: "/",                     // default: "/"       — loginAction() redirects here
  },

  // ── Debug (optional) ─────────────────────────────────────────────────────
  // Logs token refresh decisions, session resolution, middleware activity,
  // and action outcomes to the server console. Keep off in production.

  debug: process.env.NODE_ENV === "development",
});

// ── Extending the user type (optional) ──────────────────────────────────────
// Declare extra fields on SessionUser via module augmentation.
// These fields will be typed everywhere: server helpers, useSession(), middleware.

declare module "@/lib/auth" {
  interface SessionUser {
    name: string;
    role: "admin" | "user";
    avatarUrl?: string;
  }
}
```

### 3. Wrap your layout

```tsx
// app/layout.tsx
import { auth } from "@/auth";
import { AuthProvider } from "@/lib/auth/client";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthProvider actions={auth.actions}>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

That's it. Auth is ready.

---

## CLI Commands

### `init`

Scaffolds the auth library into your project. Detects your project setup (Next.js version, TypeScript, package manager, tsconfig alias) and runs interactively.

```bash
npx @ss/next-jwt-auth init
```

### `update`

Updates the library files to the latest version without touching your `auth.ts` adapter implementation. Reports added, modified, and removed files.

```bash
npx @ss/next-jwt-auth update
```

### `check`

Validates your project setup. Runs six checks and reports pass/warn/fail for each:

1. Library directory is installed
2. `auth.ts` exists
3. Adapter functions are implemented (not stubs)
4. `AuthProvider` is present in the root layout
5. `middleware.ts` / `proxy.ts` exists and is configured correctly
6. Import alias in `auth.ts` matches `tsconfig.json`

```bash
npx @ss/next-jwt-auth check
```

Exits with code `1` if any check fails.

### `--version` / `--help`

```bash
npx @ss/next-jwt-auth --version
npx @ss/next-jwt-auth --help
```

---

## Usage

### Server Components

```tsx
import { auth } from "@/auth";

// Get session (returns null if unauthenticated)
const session = await auth.getSession();

// Require session (redirects to /login if unauthenticated)
const session = await auth.requireSession();

// Require session and append ?callbackUrl= to the redirect
const session = await auth.requireSession({ includeCallbackUrl: true });

// Individual token/user helpers
const user = await auth.getUser();
const accessToken = await auth.getAccessToken();
const refreshToken = await auth.getRefreshToken();
```

### Client Components

```tsx
"use client";
import { useSession, useAuth } from "@/lib/auth/client";

function MyComponent() {
  const session = useSession();
  const { login, logout, fetchSession } = useAuth();

  if (session.status === "loading") return <Spinner />;
  if (session.status === "unauthenticated") return <LoginButton />;

  // session.status === "authenticated"
  return <p>Hello, {session.user.email}</p>;
}
```

### Login Form

```tsx
"use client";
import { useAuth } from "@/lib/auth/client";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    const result = await login({ email, password });
    if (result.success) router.push("/dashboard");
    else setError(result.error);
  }

  return <form onSubmit={handleSubmit}>...</form>;
}
```

Pass `redirect: false` to handle navigation yourself instead of letting the action redirect automatically:

```typescript
await login(credentials, { redirect: false });
await login(credentials, { redirectTo: "/onboarding" });
```

### Middleware / Route Protection

The generated `middleware.ts` (or `proxy.ts` on Next.js 16+) runs on the edge before every request. Use it for **token refresh and coarse-grained routing** — it is not a replacement for per-page auth checks.

> **Important:** `resolveAuth` reads token cookies only — it never calls your API or fetches user data. This keeps middleware fast and edge-compatible. It means `session.isAuthenticated` tells you whether a valid, non-expired access token exists in the cookie, not whether the user still exists or has a specific role. For fine-grained authorization (role checks, resource ownership, etc.) always call `auth.getSession()` or `auth.requireSession()` inside the Server Component or Server Action that needs it.

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const resolveAuth = auth.createMiddleware();

export default async function middleware(request: NextRequest) {
  const session = await resolveAuth(request);
  const { pathname } = request.nextUrl;

  const isProtected = auth.matchesPath(pathname, ["/dashboard/:path*", "/settings"]);
  const isAuthPage = auth.matchesPath(pathname, ["/login", "/register"]);

  // Redirect unauthenticated users away from protected routes
  if (isProtected && !session.isAuthenticated) {
    return session.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from auth pages
  if (isAuthPage && session.isAuthenticated) {
    return session.redirect(new URL("/dashboard", request.url));
  }

  return session.response(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Then guard individual pages with `requireSession()` inside the page itself:

```tsx
// app/dashboard/page.tsx
import { auth } from "@/auth";

export default async function DashboardPage() {
  // This calls your adapter's fetchUser — confirms the session is real and fresh
  const session = await auth.requireSession();

  return <p>Welcome, {session.user.email}</p>;
}
```

**Path pattern syntax:**

| Pattern | Matches |
|---------|---------|
| `/dashboard` | Exact path only |
| `/dashboard/:path*` | `/dashboard` and all sub-routes |
| `/user/:id` | `/user/123`, `/user/abc`, etc. |

### SSR Hydration

Pass `initialSession` from the server to eliminate the loading flash on first render:

```tsx
// app/layout.tsx
import { auth } from "@/auth";
import { AuthProvider } from "@/lib/auth/client";

export default async function RootLayout({ children }) {
  const session = await auth.getSession();

  return (
    <html>
      <body>
        <AuthProvider actions={auth.actions} initialSession={session}>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

- `initialSession={session}` — starts as `"authenticated"` with user data (no fetch on mount)
- `initialSession={null}` — starts as `"unauthenticated"` immediately (server confirmed no session)
- `initialSession` omitted — starts as `"loading"`, fetches on mount (default behavior)

> **Static rendering:** If you want your layout to be statically rendered at build time (e.g. for a marketing site or a public-facing shell), do **not** call `auth.getSession()` in the layout and pass it to `AuthProvider`. Reading cookies in the layout forces Next.js to opt the entire route into dynamic rendering. Instead, omit `initialSession` and let the client fetch the session on mount — your layout stays static and only the parts that need auth become dynamic.

### Session Expiry Handling

Use `onSessionExpired` to react when a background revalidation discovers the session has ended:

```tsx
<AuthProvider
  actions={auth.actions}
  onSessionExpired={() => {
    toast.error("Your session expired. Please log in again.");
    router.push("/login");
  }}
>
  {children}
</AuthProvider>
```

Disable the automatic refresh-on-focus behavior if needed:

```tsx
<AuthProvider actions={auth.actions} refreshOnFocus={false}>
  {children}
</AuthProvider>
```

### Data Fetching Utilities

Run server-side data fetches that automatically receive the current session:

```typescript
import { auth } from "@/auth";

// Run callback if session exists, return null otherwise
const data = await auth.withSession(async (session) => {
  return fetchPublicFeed(session.user.id);
});

// Run callback or redirect to sign-in
const data = await auth.withRequiredSession(async (session) => {
  return fetchProtectedData(session.accessToken);
});
```

---

## File Structure

After running `init`, your project will have:

```
auth.ts                        ← Your adapter + config (edit this)
middleware.ts                  ← Route protection (edit this; proxy.ts on Next.js 16+)
lib/auth/
  .version                     ← Installed CLI version (do not edit — used by `update`)
  index.ts                     ← Auth() factory + all public exports
  types.ts                     ← All TypeScript types
  config.ts                    ← Global config singleton (internal)
  core/
    jwt.ts                     ← JWT decode + expiry utilities
    cookies.ts                 ← httpOnly cookie helpers
    config.ts                  ← Config builder + defaults
  server/
    session.ts                 ← getSession(), requireSession(), etc.
    actions.ts                 ← Server Actions (login, logout, fetchSession)
    fetchers.ts                ← withSession(), withRequiredSession()
  middleware/
    auth-middleware.ts         ← Middleware resolver + matchesPath()
  client/
    provider.tsx               ← <AuthProvider>, useSession(), useAuth()
```

---

## API Reference

### `Auth(config)` — `auth.ts`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapter.login` | `(credentials) => Promise<TokenPair>` | required | Authenticate and return tokens |
| `adapter.refreshToken` | `(token) => Promise<TokenPair>` | required | Exchange refresh token for new pair |
| `adapter.fetchUser` | `(token) => Promise<SessionUser>` | required | Return user data for an access token |
| `adapter.logout` | `(tokens) => Promise<void>` | optional | Invalidate refresh token server-side |
| `cookies.name` | `string` | `"auth-session"` | Cookie base name |
| `cookies.secure` | `boolean` | `true` in prod | Secure cookie flag |
| `cookies.sameSite` | `string` | `"lax"` | SameSite cookie attribute |
| `refresh.refreshThresholdSeconds` | `number` | `60` | Seconds before expiry to proactively refresh. Refresh triggers when this many seconds remain on the access token |
| `pages.signIn` | `string` | `"/login"` | Sign-in page — used by `requireSession()` and post-logout redirect |
| `pages.home` | `string` | `"/"` | Post-login redirect |
| `debug` | `boolean` | `false` | Log debug info to console |

### Server Helpers

| Function | Returns | Description |
|----------|---------|-------------|
| `auth.getSession()` | `Session \| null` | Current session or null |
| `auth.requireSession(opts?)` | `Session` | Session or redirect to sign-in |
| `auth.getUser()` | `SessionUser \| null` | Current user or null |
| `auth.getAccessToken()` | `string \| null` | Current access token or null |
| `auth.getRefreshToken()` | `string \| null` | Current refresh token or null |
| `auth.withSession(cb, default?)` | `TResult \| null` | Run callback if authenticated |
| `auth.withRequiredSession(cb)` | `TResult` | Run callback or redirect |

### Middleware

| Function | Returns | Description |
|----------|---------|-------------|
| `auth.createMiddleware()` | `(req) => Promise<AuthMiddlewareResult>` | Creates middleware resolver with auto token refresh |
| `auth.matchesPath(pathname, patterns)` | `boolean` | Match pathname against wildcard patterns |

`AuthMiddlewareResult` has:
- `isAuthenticated: boolean` — valid, non-expired access token exists in cookie
- `accessToken: string \| null`
- `refreshToken: string \| null`
- `response(base: NextResponse): NextResponse` — applies refreshed cookies to response
- `redirect(url: URL): NextResponse` — redirects and clears token cookies

### Client Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useSession()` | `ClientSession` | Reactive session state (`"loading"` / `"authenticated"` / `"unauthenticated"`) |
| `useAuth()` | `{ login, logout, fetchSession }` | Auth action handlers. `fetchSession` syncs client state — silently rotates tokens if expired before returning |

### `<AuthProvider>` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `actions` | `AuthActions` | required | Pass `auth.actions` from your `auth.ts` |
| `initialSession` | `Session \| null \| undefined` | `undefined` | Server session for SSR hydration |
| `onSessionExpired` | `() => void` | — | Called when background revalidation finds session gone |
| `refreshOnFocus` | `boolean` | `true` | Revalidate session when tab regains focus |

---

## License

MIT
