import path from "path";
import fs from "fs-extra";
import { resolveCwd } from "../utils/fs";
import { logger } from "../utils/logger";

// Injected at build time from the root monorepo package.json by tsup's `define`
declare const __LIB_VERSION__: string;

/**
 * Copies the bundled library files from dist/files/lib/auth/
 * into the user's project at the specified target directory.
 *
 * At publish time, tsup copies packages/cli/files/ → dist/files/
 * so these files are always available at runtime.
 */
export async function copyLibraryFiles(targetDir: string): Promise<void> {
  // __dirname at runtime = dist/ (after tsup build)
  const sourceDir = path.join(__dirname, "files", "lib", "auth");
  const destDir = resolveCwd(targetDir);

  await fs.ensureDir(destDir);
  await fs.copy(sourceDir, destDir, { overwrite: true });

  // Write a .version file so users can always tell which lib version is installed.
  // Version comes from the root monorepo package.json, injected at build time.
  // Used by the `update` command to show version changes.
  await fs.writeFile(path.join(destDir, ".version"), __LIB_VERSION__, "utf-8");

  logger.success(`Library files copied to ${targetDir}/`);
}
