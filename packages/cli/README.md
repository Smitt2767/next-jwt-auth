# @smittdev/next-jwt-auth

Zero-config JWT authentication scaffolder for Next.js App Router, specifically designed for integrating with **3rd-party backend APIs**.

Run one command. Get a complete, production-ready auth system in your project — fully typed, fully yours.

```bash
npx @smittdev/next-jwt-auth init
```

---

## When to use this vs. Auth.js

[Auth.js (NextAuth)](https://authjs.dev/) is an incredible library and the gold standard for OAuth integrations (Google, GitHub, Apple, etc.). If your Next.js application *is* your backend and you need OAuth, you should use Auth.js.

However, **if you have a separate backend (Node, Go, Python, Java, etc.) that handles authentication and issues its own JWTs**, wiring it into Next.js can be tricky. This library exists to solve that specific problem.

It bridges the gap between your Next.js frontend and your external API server by:
- Managing the short-lived **access token** + long-lived **refresh token** lifecycle.
- Silently refreshing tokens before they expire using Next.js Middleware.
- Automatically synchronizing the user's session between Server Components and Client Components.

Instead of fighting an opinionated session format, this library scaffolds the plumbing and gets out of your way. You implement three adapter functions (`login`, `refreshToken`, `fetchUser`) that fetch from your API, and you own the resulting session.

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
npx @smittdev/next-jwt-auth init
```

You'll be asked:
- Where to place the library (default: `lib/auth/` or `src/lib/auth/`)
- Whether to generate `middleware.ts` (or `proxy.ts` for Next.js 16+)
- Whether to strip all comments from scaffolded files
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
npx @smittdev/next-jwt-auth init
```

### `update`

Updates the library files to the latest version without touching your `auth.ts` adapter implementation. Reports added, modified, and removed files.

```bash
npx @smittdev/next-jwt-auth update

# Preview what would change without writing any files
npx @smittdev/next-jwt-auth update --dry-run
```

### `check`

Validates your project setup. Runs up to eight checks and reports pass/warn/fail for each:

1. Library directory is installed
2. `auth.ts` exists
3. Adapter functions are implemented (not stubs)
4. `AuthProvider` is present in the root layout
5. `middleware.ts` / `proxy.ts` exists and is configured correctly
6. Import alias in `auth.ts` matches `tsconfig.json`
7. OAuth route exists at `app/api/auth/[...oauth]/route.ts` _(only when OAuth is installed)_
8. `adapter.oauthLogin` is implemented _(only when OAuth is installed)_

```bash
npx @smittdev/next-jwt-auth check
```

Exits with code `1` if any check fails.

### `uninstall`

Removes the scaffolded auth files from your project. Interactively asks whether to delete the library directory, `auth.ts`, and `middleware.ts` / `proxy.ts` — so you can keep whatever you want.

```bash
npx @smittdev/next-jwt-auth uninstall
```

> `auth.ts` defaults to **no** when prompted — it contains your adapter implementation and is skipped unless you explicitly confirm.

### `add oauth`

Adds OAuth provider support (Google, GitHub) to an existing installation. Run this after `init`.

```bash
npx @smittdev/next-jwt-auth add oauth
```

This command:
- Prompts you to select which providers to install (Google, GitHub, or both)
- Copies provider files into your library directory
- Generates the catch-all OAuth route at `app/api/auth/[...oauth]/route.ts`
- Shows a preview of the changes needed in `auth.ts` and optionally patches them automatically

After running, you still need to:
1. Register callback URLs with each provider (see [OAuth Setup](#oauth-setup) below)
2. Add the required environment variables
3. Implement `adapter.oauthLogin()` in your `auth.ts`

### `--version` / `--help`

```bash
npx @smittdev/next-jwt-auth --version
npx @smittdev/next-jwt-auth --help
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

Pass `redirect: false` to handle navigation yourself, or `callbackUrl` to control the destination:

```typescript
await login(credentials, { redirect: false });
await login(credentials, { callbackUrl: "/onboarding" });
```

### OAuth Login

> Requires running `npx @smittdev/next-jwt-auth add oauth` first.

#### OAuth Setup

**1. Register callback URLs with each provider:**

| Provider | Callback URL to register |
|----------|--------------------------|
| Google | `https://your-domain.com/api/auth/google/callback` |
| GitHub | `https://your-domain.com/api/auth/github/callback` |

- **Google**: [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs
- **GitHub**: Settings → Developer settings → OAuth Apps → your app → Authorization callback URL

**2. Add environment variables:**

```bash
# .env.local
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

**3. Add providers and implement `oauthLogin` in `auth.ts`:**

```typescript
// auth.ts
import { Auth } from "@/lib/auth";
import { GoogleProvider, GitHubProvider } from "@/lib/auth/providers";

export const auth = Auth({
  adapter: {
    // ... your existing login, refreshToken, fetchUser ...

    // Called after a successful OAuth callback.
    // Exchange the provider's user profile for your own JWT tokens.
    //
    // @param provider            - "google" | "github"
    // @param userInfo            - Normalized profile: { id, email, name, picture, raw }
    // @param providerAccessToken - Raw access token from the provider.
    //                              Forward to your backend if it needs to call provider APIs.
    async oauthLogin(provider, userInfo, providerAccessToken) {
      const res = await fetch("https://your-api.com/auth/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, userInfo, providerAccessToken }),
      });
      if (!res.ok) throw new Error("OAuth login failed");
      return res.json(); // must return { accessToken, refreshToken }
    },
  },

  providers: [
    new GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    new GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
});
```

**4. Add OAuth buttons to your login page:**

```tsx
"use client";
import { useAuth } from "@/lib/auth/client";

export function LoginPage() {
  const { oauthLogin } = useAuth();

  return (
    <div>
      <button onClick={() => oauthLogin("google")}>
        Sign in with Google
      </button>
      <button onClick={() => oauthLogin("github")}>
        Sign in with GitHub
      </button>
      {/* Redirect to /dashboard after login */}
      <button onClick={() => oauthLogin("google", { callbackUrl: "/dashboard" })}>
        Sign in with Google
      </button>
    </div>
  );
}
```

`oauthLogin(provider, options?)` redirects the browser to `/api/auth/[provider]/login`, which starts the OAuth flow. On success, the user is redirected to `callbackUrl` if provided, otherwise to `pages.home`.

#### How the OAuth flow works

```
Browser                Next.js                  Provider
  │                       │                         │
  ├─ GET /api/auth/google/login ──────────────────► │
  │                       │  generate state + PKCE  │
  │                       │  store in httpOnly cookie│
  │◄──────────── 302 redirect to Google ────────────┤
  │                       │                         │
  ├─────────────────────────────────── user consents ┤
  │                       │                         │
  ├─ GET /api/auth/google/callback?code=...&state=.. ┤
  │                       │  validate state (CSRF)  │
  │                       │  validate PKCE verifier │
  │                       │  exchange code for token│
  │                       │  fetch user profile     │
  │                       │  call adapter.oauthLogin│
  │                       │  set session cookies    │
  │◄──────────── 302 redirect to /dashboard ────────┤
```

The OAuth flow uses both **CSRF state** and **PKCE (S256)** for security. The PKCE `code_verifier` is stored in an `httpOnly` cookie and never exposed to the browser.

### Middleware / Route Protection

The generated `middleware.ts` (or `proxy.ts` on Next.js 16+) runs on the edge before every request. Use it for **token refresh and coarse-grained routing** — it is not a replacement for per-page auth checks.

> **Important Limitation:** The Next.js middleware *only* runs when a page navigation happens or when users explicitly refresh the page. This library will silently refresh expired tokens dynamically *during those requests*. **However**, if you have long-lived client-side pages and make API requests with `axios` or `fetch`, the middleware will NOT run for those API requests. You must handle silent refreshes for client-side API calls inside an interceptor and then call `updateSessionToken(newToken)` to sync the new token into the cookies so the rest of the app can see it.

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
  metadata.json                ← Install config (do not edit — used by CLI commands)
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
  handlers/
    index.ts                   ← Stub handler (replaced by add oauth)
```

After running `add oauth`, the following are also added:

```
app/api/auth/[...oauth]/
  route.ts                     ← OAuth catch-all route (do not edit)
lib/auth/
  providers/
    base.ts                    ← Abstract OAuthProvider base class (extend for custom providers)
    google.ts                  ← GoogleProvider
    github.ts                  ← GitHubProvider
    index.ts                   ← Re-exports (only installed providers)
  handlers/
    oauth.ts                   ← PKCE + CSRF handler: login initiation + code exchange + callback
    index.ts                   ← createOAuthHandler() export
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
| `adapter.oauthLogin` | `(provider, userInfo, providerAccessToken) => Promise<TokenPair>` | optional | Exchange OAuth profile for your own JWT pair. Required when using OAuth providers |
| `providers` | `OAuthProvider[]` | `[]` | Provider instances. Add after running `add oauth` |
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
| `useAuth()` | `{ login, logout, fetchSession, updateSessionToken, oauthLogin }` | Auth action handlers. `fetchSession` syncs client state — silently rotates tokens if expired before returning. `updateSessionToken` allows injecting a new accessToken from outside the library (e.g. via an axios interceptor) and syncing it into the cookies. `oauthLogin(provider, options?)` redirects to the OAuth login route — `provider` is `"google" \| "github"`, `options.callbackUrl` controls the post-login destination. |

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
