import path from "path";
import fs from "fs-extra";
import { resolveCwd, dirExists } from "../utils/fs";
import { logger } from "../utils/logger";

/**
 * Detects whether the project uses a src/ layout by checking for src/app vs app,
 * using the same logic as detectProject().
 *
 * src/ layout = src/app exists AND root app/ does NOT exist.
 */
function detectSrcDir(): boolean {
  const hasSrcApp = dirExists(resolveCwd("src", "app"));
  const hasRootApp = dirExists(resolveCwd("app"));
  return hasSrcApp && !hasRootApp;
}

/**
 * Scaffolds the Next.js catch-all OAuth route handler at:
 *   app/api/auth/[...oauth]/route.ts  (root layout)
 *   src/app/api/auth/[...oauth]/route.ts  (src/ layout)
 *
 * The src/ layout is detected live from the filesystem (same logic as init),
 * not from stored metadata — so it stays correct even if the project structure
 * changed after init was run.
 *
 * The generated file re-exports GET from auth.handlers so the user's auth.ts
 * is the single source of truth for provider configuration.
 */
export async function generateOAuthRoute(alias: string): Promise<void> {
  const srcDir = detectSrcDir();

  const routeDir = srcDir
    ? resolveCwd("src", "app", "api", "auth", "[...oauth]")
    : resolveCwd("app", "api", "auth", "[...oauth]");

  const routePath = path.join(routeDir, "route.ts");

  // alias is e.g. "@/" so the import becomes "@/auth"
  const authImport = `${alias}auth`;

  const displayPath = srcDir
    ? "src/app/api/auth/[...oauth]/route.ts"
    : "app/api/auth/[...oauth]/route.ts";

  const content = `// ${displayPath}
//
// OAuth catch-all route — managed by @smittdev/next-jwt-auth.
// Configure providers in auth.ts, not here.

import { auth } from "${authImport}";

export const { GET } = auth.handlers;
`;

  await fs.ensureDir(routeDir);
  await fs.writeFile(routePath, content, "utf-8");

  logger.success(`OAuth route created at ${displayPath}`);
}
