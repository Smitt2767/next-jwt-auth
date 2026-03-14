import path from "path";
import fs from "fs-extra";
import { resolveCwd } from "../utils/fs";
import { logger } from "../utils/logger";

/** Provider IDs supported by the CLI. */
export type ProviderId = "google" | "github";

/**
 * Copies OAuth provider + handler files from the bundled template into the
 * user's auth lib directory.
 *
 * Files copied:
 *   dist/files/oauth/providers/base.ts           → authDir/providers/base.ts
 *   dist/files/oauth/providers/<id>.ts  per id   → authDir/providers/<id>.ts
 *   dist/files/oauth/handlers/index.ts            → authDir/handlers/index.ts
 *   dist/files/oauth/handlers/oauth.ts            → authDir/handlers/oauth.ts
 *
 * Also generates authDir/providers/index.ts dynamically, re-exporting only the
 * providers that are actually installed (avoids referencing missing files).
 */
export async function copyOAuthFiles(
  authDir: string,
  providers: ProviderId[],
): Promise<void> {
  const srcBase = path.join(__dirname, "files", "oauth");
  const destDir = resolveCwd(authDir);

  // ── Copy provider base class ──────────────────────────────────────────────
  const providersSrcDir = path.join(srcBase, "providers");
  const providersDestDir = path.join(destDir, "providers");
  await fs.ensureDir(providersDestDir);

  // base.ts is always copied
  await fs.copy(
    path.join(providersSrcDir, "base.ts"),
    path.join(providersDestDir, "base.ts"),
    { overwrite: true },
  );

  // ── Copy each selected provider ───────────────────────────────────────────
  for (const id of providers) {
    await fs.copy(
      path.join(providersSrcDir, `${id}.ts`),
      path.join(providersDestDir, `${id}.ts`),
      { overwrite: true },
    );
  }

  // ── Generate providers/index.ts dynamically ───────────────────────────────
  const providerExports = providers
    .map((id) => {
      const className = providerClassName(id);
      return `export { ${className} } from "./${id}";`;
    })
    .join("\n");

  const providersIndex = `// lib/auth/providers/index.ts
//
// This file is managed by @smittdev/next-jwt-auth.
// Re-run \`npx @smittdev/next-jwt-auth add oauth\` to regenerate after adding providers.

export { OAuthProvider } from "./base";
export type { OAuthProviderConfig } from "./base";
${providerExports}
`;

  await fs.writeFile(
    path.join(providersDestDir, "index.ts"),
    providersIndex,
    "utf-8",
  );

  // ── Copy handlers ─────────────────────────────────────────────────────────
  const handlersSrcDir = path.join(srcBase, "handlers");
  const handlersDestDir = path.join(destDir, "handlers");
  await fs.copy(handlersSrcDir, handlersDestDir, { overwrite: true });

  logger.success(`OAuth providers copied: ${providers.join(", ")}`);
}

/** Maps a provider id to its exported class name. */
function providerClassName(id: ProviderId): string {
  const map: Record<ProviderId, string> = {
    google: "GoogleProvider",
    github: "GitHubProvider",
  };
  return map[id];
}
