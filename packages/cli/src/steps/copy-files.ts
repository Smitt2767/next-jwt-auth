import path from "path";
import fs from "fs-extra";
import { resolveCwd } from "../utils/fs";
import { logger } from "../utils/logger";
import { stripJsDocFromDir } from "../utils/strip-jsdoc";

/**
 * Copies the bundled library files from dist/files/lib/auth/
 * into the user's project at the specified target directory.
 *
 * At publish time, tsup copies packages/cli/files/ → dist/files/
 * so these files are always available at runtime.
 *
 * @param targetDir - Destination path relative to the user's project root.
 * @param clean     - When `true`, all JSDoc block comments are stripped from the copied files.
 */
export async function copyLibraryFiles(targetDir: string, clean = false): Promise<void> {
  // __dirname at runtime = dist/ (after tsup build)
  const sourceDir = path.join(__dirname, "files", "lib", "auth");
  const destDir = resolveCwd(targetDir);

  await fs.ensureDir(destDir);
  await fs.copy(sourceDir, destDir, { overwrite: true });

  if (clean) {
    await stripJsDocFromDir(destDir);
  }

  logger.success(`Library files copied to ${targetDir}/`);
}
