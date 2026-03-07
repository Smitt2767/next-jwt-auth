# @ss/next-jwt-auth

Zero-config JWT authentication scaffolder for Next.js App Router.

Run one command. Get a complete, production-ready auth system in your project — fully typed, fully yours.

```bash
npx @ss/next-jwt-auth init
```

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
- Where to place the library (default: `lib/auth/`)
- Whether to generate `middleware.ts`
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
      return res.json(); // { id, email, name, ... }
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

## Usage

### Server Components

```tsx
import { auth } from "@/auth";

// Get session (returns null if unauthenticated)
const session = await auth.getSession();

// Require session (redirects to /login if unauthenticated)
const session = await auth.requireSession();

// Individual helpers
const user = await auth.getUser();
const token = await auth.getAccessToken();
```

### Client Components

```tsx
"use client";
import { useSession, useAuth } from "@/lib/auth/client";

function MyComponent() {
  const session = useSession();
  const { login, logout, isLoading } = useAuth();

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

Now `session.user.name` and `session.user.role` are fully typed everywhere.

---

## File Structure

After running `init`, your project will have:

```
auth.ts                        ← Your adapter + config (edit this)
middleware.ts                  ← Route protection (edit this)
lib/auth/
  index.ts                     ← Auth() factory + all public exports
  types.ts                     ← All TypeScript types
  config.ts                    ← Global config singleton (internal)
  core/
    jwt.ts                     ← JWT decode + expiry utilities
    cookies.ts                 ← httpOnly cookie helpers
    config.ts                  ← Config builder
  server/
    session.ts                 ← getSession(), requireSession(), etc.
    actions.ts                 ← Server Actions (login, logout, refresh)
    fetchers.ts                ← authenticatedFetch(), withSession(), etc.
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
| `adapter.login` | `(creds) => Promise<TokenPair>` | required | Authenticate and return tokens |
| `adapter.refreshToken` | `(token) => Promise<TokenPair>` | required | Exchange refresh token for new pair |
| `adapter.fetchUser` | `(token) => Promise<SessionUser>` | required | Return user data for an access token |
| `adapter.logout` | `(tokens) => Promise<void>` | optional | Invalidate refresh token server-side |
| `cookies.name` | `string` | `"auth-session"` | Cookie base name |
| `cookies.secure` | `boolean` | `true` in prod | Secure cookie flag |
| `refresh.refreshThresholdSeconds` | `number` | `120` | Refresh when this many seconds remain |
| `pages.signIn` | `string` | `"/login"` | Sign-in page path |
| `pages.afterSignIn` | `string` | `"/dashboard"` | Post-login redirect |
| `pages.afterSignOut` | `string` | `"/"` | Post-logout redirect |

### Server Helpers

| Function | Returns | Description |
|----------|---------|-------------|
| `auth.getSession()` | `Session \| null` | Current session or null |
| `auth.requireSession()` | `Session` | Session or redirect to sign-in |
| `auth.getUser()` | `SessionUser \| null` | Current user or null |
| `auth.getAccessToken()` | `string \| null` | Current access token or null |
| `auth.authenticatedFetch(url, opts)` | `Promise<Response>` | fetch with auto Bearer token |
| `auth.withSession(cb)` | `TResult \| null` | Run callback if authenticated |
| `auth.withRequiredSession(cb)` | `TResult` | Run callback or redirect |
| `auth.createSessionFetcher(fn)` | `(...args) => Promise<TData>` | Reusable session-aware fetcher |

### Client Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useSession()` | `ClientSession` | Reactive session state |
| `useAuth()` | `{ login, logout, refresh, isLoading }` | Auth action handlers |

---

## License

MIT
