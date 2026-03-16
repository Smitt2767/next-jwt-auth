import fs from "fs-extra";
import path from "path";
import { resolveCwd } from "../utils/fs";
import { logger } from "../utils/logger";
import { stripJsDoc } from "../utils/strip-jsdoc";

/**
 * Parses the major version from a package.json version string.
 * Handles specifiers like "^15.0.0", "~16.1.0", ">=15", "15.5.12".
 */
function parseMajorVersion(versionStr: string | null): number {
  if (!versionStr) return 0;
  const cleaned = versionStr.replace(/^[\^~>=<\s]+/, "");
  const major = parseInt(cleaned.split(".")[0], 10);
  return isNaN(major) ? 0 : major;
}

/**
 * Generates the middleware file.
 *
 * - Placed in `src/` if the project uses a src directory layout.
 * - Named `proxy.ts` for Next.js >= 16, `middleware.ts` otherwise.
 * - Route protection logic is intentionally left as comments — the user
 *   decides what is public and what is protected.
 *
 * @param srcDir      - True if the project uses a src/ directory layout
 * @param nextVersion - Raw next version string from package.json
 * @param alias       - The tsconfig import alias prefix (e.g. "@/" or "~/"). Defaults to "@/".
 */
export async function generateMiddlewareFile(
  srcDir: boolean,
  nextVersion: string | null,
  alias: string = "@/",
  clean = false,
): Promise<{ fileName: string; filePath: string }> {
  const majorVersion = parseMajorVersion(nextVersion);
  // Next.js 16+ uses proxy.ts as the middleware entrypoint
  const fileName = majorVersion >= 16 ? "proxy.ts" : "middleware.ts";

  // Next.js looks for middleware in the project root OR in src/
  const fileDir = srcDir ? resolveCwd("src") : resolveCwd(".");
  const filePath = path.join(fileDir, fileName);

  await fs.ensureDir(fileDir);

  // For src/ layouts the alias already resolves into src/, so we use e.g. "@/auth".
  // For root layouts without src/, we use the alias too since tsconfig maps it to "./*".
  const authImport = srcDir ? `${alias}auth` : `./auth`;

  const content = `import { NextRequest, NextResponse } from "next/server";
import { auth } from "${authImport}";

/**
 * ${fileName} — Route protection via @ss/next-jwt-auth
 *
 * The middleware runs on every request matched by config.matcher below.
 * It silently refreshes expired access tokens so sessions stay alive.
 *
 * HOW IT WORKS:
 *   1. resolveAuth() reads cookies, verifies the access token, and refreshes
 *      it transparently if it is near expiry or expired.
 *   2. session.isAuthenticated — true if a valid session exists.
 *   3. session.response(base) — writes refreshed token cookies onto your response.
 *      Always wrap your final NextResponse with this.
 *   4. session.redirect(url) — redirects and clears session cookies.
 *      Use this when sending unauthenticated users to the login page.
 *
 * ─── PROTECTING ROUTES ──────────────────────────────────────────────────────
 *
 * Uncomment and adapt the examples below to match your route structure.
 * auth.matchesPath() supports wildcards: "/dashboard/:path*" matches all sub-routes.
 *
 * Example — redirect unauthenticated users away from protected routes:
 *
 *   if (!session.isAuthenticated && auth.matchesPath(pathname, ["/dashboard/:path*", "/settings/:path*"])) {
 *     const loginUrl = new URL("/login", request.url);
 *     loginUrl.searchParams.set("callbackUrl", pathname);
 *     return session.redirect(loginUrl);
 *   }
 *
 * Example — redirect authenticated users away from public-only routes:
 *
 *   if (session.isAuthenticated && auth.matchesPath(pathname, ["/login", "/register"])) {
 *     return session.response(NextResponse.redirect(new URL("/", request.url)));
 *   }
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

const resolveAuth = auth.createMiddleware();

export default async function ${majorVersion >= 16 ? "proxy" : "middleware"}(request: NextRequest) {
  const session = await resolveAuth(request);
  const { pathname } = request.nextUrl;

  // Add your route protection logic here.
  // See the comments above for examples.

  // Pass through — always wrap with session.response() to write refreshed cookies
  return session.response(NextResponse.next());
}

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`;

  await fs.writeFile(filePath, clean ? stripJsDoc(content) : content, "utf-8");
  const displayPath = srcDir ? `src/${fileName}` : fileName;
  logger.success(`Generated ${displayPath}`);

  return { fileName, filePath };
}
