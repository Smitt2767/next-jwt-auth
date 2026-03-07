import fs from "fs-extra";
import path from "path";
import { resolveCwd } from "../utils/fs";
import { logger } from "../utils/logger";

/**
 * Generates the user-facing auth.ts file.
 *
 * - With root layout:  written to  <root>/auth.ts,  imports from "@/lib/auth"
 * - With src/ layout:  written to  <root>/src/auth.ts, imports from "@/lib/auth"
 *   (because Next.js maps "@/" → "./src/", so the "src/" prefix is stripped)
 *
 * @param authDir - The path where the library was installed (e.g. "lib/auth" or "src/lib/auth")
 * @param srcDir  - True if the project uses a src/ directory layout
 */
export async function generateAuthFile(
  authDir: string,
  srcDir: boolean,
): Promise<void> {
  // Strip the leading "src/" from the import path because Next.js tsconfig
  // maps "@/*" → "./src/*", so "@/lib/auth" already resolves to "src/lib/auth".
  const importSegment =
    srcDir && authDir.startsWith("src/")
      ? authDir.slice("src/".length)
      : authDir;
  const importPath = `@/${importSegment}`;

  // auth.ts lives at the root in both layouts, BUT with src/ layout
  // Next.js resolves "@/auth" → "src/auth.ts", so we write it there.
  const authFilePath = srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");

  await fs.ensureDir(path.dirname(authFilePath));

  const content = `import { Auth } from "${importPath}";

/**
 * Extend SessionUser with your own fields via module augmentation.
 *
 * Any fields you add here will be fully typed everywhere in your app:
 *   - session.user.name in Server Components
 *   - session.user in useSession() on the client
 *   - session.user in middleware
 *
 * Example:
 *
 *   declare module "${importPath}" {
 *     interface SessionUser {
 *       name: string;
 *       role: "admin" | "user";
 *       avatarUrl?: string;
 *     }
 *   }
 */

export const auth = Auth({
  adapter: {
    /**
     * Called when the user submits your login form.
     * Receives whatever credentials object you pass to login().
     * Must return { accessToken, refreshToken } or throw an Error.
     *
     * Example:
     *   const res = await fetch("https://your-api.com/auth/login", {
     *     method: "POST",
     *     headers: { "Content-Type": "application/json" },
     *     body: JSON.stringify(credentials),
     *   });
     *   if (!res.ok) throw new Error("Invalid credentials");
     *   return res.json(); // { accessToken: "...", refreshToken: "..." }
     */
    async login(credentials) {
      throw new Error("login() not implemented — edit auth.ts to connect your API");
    },

    /**
     * Called automatically when the access token is near expiry.
     * Receives the current refresh token.
     * Must return { accessToken, refreshToken } or throw an Error.
     *
     * Example:
     *   const res = await fetch("https://your-api.com/auth/refresh", {
     *     method: "POST",
     *     headers: { "Content-Type": "application/json" },
     *     body: JSON.stringify({ refreshToken }),
     *   });
     *   if (!res.ok) throw new Error("Session expired");
     *   return res.json(); // { accessToken: "...", refreshToken: "..." }
     */
    async refreshToken(refreshToken) {
      throw new Error("refreshToken() not implemented — edit auth.ts to connect your API");
    },

    /**
     * Called after login and refresh to hydrate the user object.
     * Receives the fresh access token.
     * Must return an object with at least { id: string, email: string }.
     * Add extra fields by extending SessionUser above.
     *
     * Example:
     *   const res = await fetch("https://your-api.com/me", {
     *     headers: { Authorization: \`Bearer \${accessToken}\` },
     *   });
     *   if (!res.ok) throw new Error("Failed to fetch user");
     *   return res.json(); // { id: "1", email: "user@example.com", name: "..." }
     */
    async fetchUser(accessToken) {
      throw new Error("fetchUser() not implemented — edit auth.ts to connect your API");
    },

    /**
     * Optional: called on logout to invalidate the refresh token server-side.
     * If omitted, only the httpOnly cookies are cleared on logout.
     *
     * Example:
     *   await fetch("https://your-api.com/auth/logout", {
     *     method: "POST",
     *     headers: { "Content-Type": "application/json" },
     *     body: JSON.stringify({ refreshToken: tokens.refreshToken }),
     *   });
     */
    // async logout(tokens) {},
  },

  /**
   * All configuration below is optional — defaults shown.
   */

  // cookies: {
  //   name: "auth-session",          // Generates "auth-session.access" + "auth-session.refresh" cookies
  //   secure: true,                  // Defaults to true in production, false in development
  //   sameSite: "lax",
  //   path: "/",
  //   domain: undefined,             // Set for cross-subdomain auth
  // },

  // refresh: {
  //   refreshThresholdSeconds: 120,  // Refresh when < 2 minutes remain on the access token
  // },

  // pages: {
  //   signIn: "/login",              // Where to redirect unauthenticated users
  //   afterSignIn: "/dashboard",     // Where to redirect after successful login
  //   afterSignOut: "/",             // Where to redirect after logout
  // },
});
`;

  await fs.writeFile(authFilePath, content, "utf-8");
  const displayPath = srcDir ? "src/auth.ts" : "auth.ts";
  logger.success(`Generated ${displayPath}`);
}
