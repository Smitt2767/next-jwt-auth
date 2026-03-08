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

### 2. Implement your adapter

Open the generated `auth.ts` at your project root and fill in three functions:

```typescript
// auth.ts
import { Auth } from "@/lib/auth";

export const auth = Auth({
  adapter: {
    async login(credentials) {
      const res = await fetch("https://your-api.com/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      if (!res.ok) throw new Error("Invalid credentials");
      return res.json(); // { accessToken, refreshToken }
    },

    async refreshToken(refreshToken) {
      const res = await fetch("https://your-api.com/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) throw new Error("Session expired");
      return res.json(); // { accessToken, refreshToken }
    },

    async fetchUser(accessToken) {
      const res = await fetch("https://your-api.com/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.json(); // { id, email, ... }
    },

    // Optional — called on logout to invalidate the refresh token server-side.
    // If omitted, logout still clears cookies locally but skips the API call.
    async logout({ refreshToken }) {
      await fetch("https://your-api.com/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      // Errors here are non-fatal — cookies are cleared regardless.
    },
  },
});
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
  const { login, logout, refresh, revalidateSession, isLoading } = useAuth();

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
  const { login, isLoading } = useAuth();
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

### Extending the User Type

Add custom fields to the session user via module augmentation in `auth.ts`:

```typescript
// auth.ts
declare module "@/lib/auth" {
  interface SessionUser {
    name: string;
    role: "admin" | "user";
    avatarUrl?: string;
  }
}
```

Now `session.user.name` and `session.user.role` are fully typed everywhere — in Server Components, client hooks, and middleware.

---

## File Structure

After running `init`, your project will have:

```
auth.ts                        ← Your adapter + config (edit this)
middleware.ts                  ← Route protection (edit this; proxy.ts on Next.js 16+)
lib/auth/
  index.ts                     ← Auth() factory + all public exports
  types.ts                     ← All TypeScript types
  config.ts                    ← Global config singleton (internal)
  core/
    jwt.ts                     ← JWT decode + expiry utilities
    cookies.ts                 ← httpOnly cookie helpers
    config.ts                  ← Config builder + defaults
  server/
    session.ts                 ← getSession(), requireSession(), etc.
    actions.ts                 ← Server Actions (login, logout, refresh, fetchSession)
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
| `refresh.refreshThresholdSeconds` | `number` | `120` | Refresh when this many seconds remain |
| `pages.signIn` | `string` | `"/login"` | Sign-in page path |
| `pages.afterSignIn` | `string` | `"/"` | Post-login redirect |
| `pages.afterSignOut` | `string` | `"/login"` | Post-logout redirect |
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
| `useAuth()` | `{ login, logout, refresh, revalidateSession, isLoading }` | Auth action handlers |

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
