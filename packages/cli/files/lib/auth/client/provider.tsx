"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClientSession,
  Session,
  ActionResult,
  LoginActionOptions,
  SessionActionData,
} from "../types";

// ─── AuthActions ──────────────────────────────────────────────────────────────

export interface AuthActions {
  login(
    credentials: Record<string, unknown>,
    options?: LoginActionOptions,
  ): Promise<ActionResult<SessionActionData>>;
  logout(options?: {
    redirect?: boolean;
    redirectTo?: string;
  }): Promise<ActionResult<null>>;
  refresh(): Promise<ActionResult<SessionActionData>>;
  revalidateSession(): Promise<ActionResult<SessionActionData | null>>;
}

// ─── BroadcastChannel ────────────────────────────────────────────────────────

const BROADCAST_CHANNEL_NAME = "next-jwt-auth";

/** Messages sent over the cross-tab broadcast channel. */
type BroadcastMessage = { type: "LOGOUT" };

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

function buildAuthenticatedState(data: SessionActionData): ClientSession {
  return {
    status: "authenticated",
    user: data.user,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

// ─── AuthProvider ─────────────────────────────────────────────────────────────

export interface AuthProviderProps {
  children: React.ReactNode;
  /** Pass the server-side session from your root layout to hydrate immediately. */
  initialSession?: Session | null;
  /** The server actions object from `auth.actions`. */
  actions: AuthActions;
  /**
   * Called when a session silently expires — i.e., a background refresh or
   * revalidation fails, meaning the user was previously authenticated but
   * their tokens can no longer be renewed.
   *
   * Use this to show a "Session expired" toast or modal.
   * NOT called when the user explicitly calls logout().
   *
   * @example
   * <AuthProvider onSessionExpired={() => toast.error("Your session expired. Please log in again.")} ...>
   */
  onSessionExpired?: () => void;
  /**
   * Whether to revalidate the session when the browser tab regains focus
   * (i.e., the user switches back from another tab or app window).
   *
   * Defaults to `true`. Set to `false` if you have short-lived access tokens
   * and want to avoid frequent network requests on focus.
   *
   * When revalidation finds an expired session, `onSessionExpired` is called
   * if provided.
   */
  refreshOnFocus?: boolean;
}

/**
 * Wraps your app and provides session state + auth actions to all client components.
 *
 * Pass `initialSession` from a Server Component to hydrate state immediately —
 * no loading flicker, no client-side bootstrap request.
 *
 * ── Features ──────────────────────────────────────────────────────────────────
 *
 * Cross-tab logout sync: when the user logs out in one tab, all other open
 * tabs are immediately set to unauthenticated via the BroadcastChannel API.
 *
 * Refresh on focus: when a tab regains visibility, the session is revalidated
 * so stale state is never shown. Configurable via `refreshOnFocus` (default: true).
 *
 * Session expiry callback: supply `onSessionExpired` to be notified when a
 * background refresh fails — great for showing a toast or modal.
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
 *       <AuthProvider
 *         actions={auth.actions}
 *         initialSession={session}
 *         onSessionExpired={() => toast.error("Session expired")}
 *       >
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
  onSessionExpired,
  refreshOnFocus = true,
}: AuthProviderProps) {
  const [session, setSession] = useState<ClientSession>(() =>
    buildInitialState(initialSession),
  );
  const [isLoading, setIsLoading] = useState(false);

  // ── Stable refs ─────────────────────────────────────────────────────────────
  // Kept up-to-date so effects and callbacks always see current values without
  // needing to be re-created or re-registered on every render.

  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  // Tracks whether the user was authenticated at the point any background
  // revalidation started — used to decide if onSessionExpired should fire.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Persistent BroadcastChannel — created once, cleaned up on unmount.
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // ── Cross-tab logout sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      if (event.data.type === "LOGOUT") {
        // Another tab logged out — mirror that here immediately.
        setSession(UNAUTHENTICATED);
      }
    };

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  // ── Refresh on focus ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!refreshOnFocus) return;

    const handleVisibilityChange = async () => {
      // Only act when the tab becomes visible and the user was authenticated.
      // Avoids unnecessary network requests for unauthenticated users.
      if (
        document.visibilityState !== "visible" ||
        sessionRef.current.status !== "authenticated"
      ) {
        return;
      }

      const result = await actionsRef.current.revalidateSession();

      if (!result.success || !result.data) {
        setSession(UNAUTHENTICATED);
        // The user was authenticated when they tabbed away but the session
        // is gone now — treat this as an expiry, not an explicit logout.
        onSessionExpiredRef.current?.();
      } else {
        setSession(buildAuthenticatedState(result.data));
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshOnFocus]);

  // ── Auth callbacks ───────────────────────────────────────────────────────────

  const login = useCallback<AuthActions["login"]>(
    async (credentials, options) => {
      setIsLoading(true);
      try {
        const result = await actions.login(credentials, options);
        if (result.success) {
          setSession(buildAuthenticatedState(result.data));
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
        // Optimistically clear local state first for instant UI response.
        setSession(UNAUTHENTICATED);

        // Notify other open tabs so they also clear their session state.
        broadcastChannelRef.current?.postMessage({
          type: "LOGOUT",
        } satisfies BroadcastMessage);

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
        setSession(buildAuthenticatedState(result.data));
      } else {
        setSession(UNAUTHENTICATED);
        // Refresh failed — the user's session expired without them explicitly
        // logging out, so fire the expiry callback if one was provided.
        onSessionExpiredRef.current?.();
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
        const wasAuthenticated = sessionRef.current.status === "authenticated";
        setSession(UNAUTHENTICATED);
        // Only fire onSessionExpired if the user had an active session before
        // this revalidation — avoids calling it on initial page load for guests.
        if (wasAuthenticated) {
          onSessionExpiredRef.current?.();
        }
      } else {
        setSession(buildAuthenticatedState(result.data));
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  }, [actions]);

  const contextValue = useMemo<AuthContextValue>(
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
 * // Default: redirect after login, honouring callbackUrl from the URL
 * await login({ email, password }, { callbackUrl: searchParams.get("callbackUrl") });
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
