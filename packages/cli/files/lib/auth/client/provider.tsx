"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import type {
  ClientSession,
  Session,
  ActionResult,
  SessionActionData,
} from "../types";

// ─── AuthActions ──────────────────────────────────────────────────────────────

export interface AuthActions {
  login(
    credentials: Record<string, unknown>,
    options?: { redirect?: boolean; redirectTo?: string },
  ): Promise<ActionResult<SessionActionData>>;
  logout(options?: {
    redirect?: boolean;
    redirectTo?: string;
  }): Promise<ActionResult<null>>;
  refresh(): Promise<ActionResult<SessionActionData>>;
  revalidateSession(): Promise<ActionResult<SessionActionData | null>>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  session: ClientSession;
  login: AuthActions["login"];
  logout: AuthActions["logout"];
  refresh: AuthActions["refresh"];
  revalidateSession: AuthActions["revalidateSession"];
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInitialState(
  initialSession: Session | null | undefined,
): ClientSession {
  if (!initialSession) {
    return {
      status: "unauthenticated",
      user: null,
      accessToken: null,
      refreshToken: null,
    };
  }
  return {
    status: "authenticated",
    user: initialSession.user,
    accessToken: initialSession.accessToken,
    refreshToken: initialSession.refreshToken,
  };
}

const UNAUTHENTICATED: ClientSession = {
  status: "unauthenticated",
  user: null,
  accessToken: null,
  refreshToken: null,
};

// ─── AuthProvider ─────────────────────────────────────────────────────────────

/**
 * Wraps your app and provides session state + auth actions to all client components.
 *
 * Pass `initialSession` from a Server Component to hydrate state immediately —
 * no loading flicker, no client-side bootstrap request.
 *
 * Loading state is intentionally NOT managed by this provider. Handle loading
 * in your own components using the `isLoading` value from useAuth().
 *
 * @example
 * // app/layout.tsx
 * import { auth } from "@/auth";
 * import { AuthProvider } from "@/lib/auth/client";
 *
 * export default async function RootLayout({ children }) {
 *   const session = await auth.getSession();
 *   return (
 *     <html><body>
 *       <AuthProvider actions={auth.actions} initialSession={session}>
 *         {children}
 *       </AuthProvider>
 *     </body></html>
 *   );
 * }
 */
export function AuthProvider({
  children,
  initialSession,
  actions,
}: {
  children: React.ReactNode;
  initialSession?: Session | null;
  actions: AuthActions;
}) {
  const [session, setSession] = useState<ClientSession>(() =>
    buildInitialState(initialSession),
  );
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback<AuthActions["login"]>(
    async (credentials, options) => {
      setIsLoading(true);
      try {
        const result = await actions.login(credentials, options);
        if (result.success) {
          setSession({
            status: "authenticated",
            user: result.data.user,
            accessToken: result.data.accessToken,
            refreshToken: result.data.refreshToken,
          });
        }
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [actions],
  );

  const logout = useCallback<AuthActions["logout"]>(
    async (options) => {
      setIsLoading(true);
      try {
        setSession(UNAUTHENTICATED);
        return await actions.logout(options);
      } finally {
        setIsLoading(false);
      }
    },
    [actions],
  );

  const refresh = useCallback<AuthActions["refresh"]>(async () => {
    setIsLoading(true);
    try {
      const result = await actions.refresh();
      if (result.success) {
        setSession({
          status: "authenticated",
          user: result.data.user,
          accessToken: result.data.accessToken,
          refreshToken: result.data.refreshToken,
        });
      } else {
        setSession(UNAUTHENTICATED);
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [actions]);

  const revalidateSession = useCallback<
    AuthActions["revalidateSession"]
  >(async () => {
    setIsLoading(true);
    try {
      const result = await actions.revalidateSession();
      if (!result.success || !result.data) {
        setSession(UNAUTHENTICATED);
      } else {
        setSession({
          status: "authenticated",
          user: result.data.user,
          accessToken: result.data.accessToken,
          refreshToken: result.data.refreshToken,
        });
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [actions]);

  const contextValue = React.useMemo<AuthContextValue>(
    () => ({ session, login, logout, refresh, revalidateSession, isLoading }),
    [session, login, logout, refresh, revalidateSession, isLoading],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns the current client-side session.
 * Must be called inside a component wrapped by <AuthProvider>.
 *
 * @example
 * const session = useSession();
 * if (session.status === "unauthenticated") return <LoginPrompt />;
 * return <p>Hello, {session.user.email}</p>;
 */
export function useSession(): ClientSession {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "[next-jwt-auth] useSession() was called outside of <AuthProvider>.\n" +
        "Wrap your app in <AuthProvider> in your root layout.",
    );
  }
  return ctx.session;
}

/**
 * Returns auth action handlers and loading state.
 * Must be called inside a component wrapped by <AuthProvider>.
 *
 * @example
 * const { login, logout, isLoading } = useAuth();
 *
 * // Default: redirect after login (like next-auth)
 * await login({ email, password });
 *
 * // Disable redirect — handle navigation yourself
 * const result = await login({ email, password }, { redirect: false });
 * if (result.success) router.push("/dashboard");
 *
 * // Logout with default redirect
 * await logout();
 *
 * // Logout without redirect — handle it yourself
 * const result = await logout({ redirect: false });
 * if (result.success) router.replace("/");
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "[next-jwt-auth] useAuth() was called outside of <AuthProvider>.\n" +
        "Wrap your app in <AuthProvider> in your root layout.",
    );
  }
  return {
    login: ctx.login,
    logout: ctx.logout,
    refresh: ctx.refresh,
    revalidateSession: ctx.revalidateSession,
    isLoading: ctx.isLoading,
  };
}
