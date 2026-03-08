import prompts from "prompts";
import pc from "picocolors";
import fs from "fs-extra";
import {
  detectProject,
  detectExistingAuthDir,
  parseMajorVersion,
} from "../steps/detect";
import { resolveCwd, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";

/**
 * `npx @ss/next-jwt-auth uninstall`
 *
 * Removes the scaffolded auth library files from the project.
 * Interactively asks which files to delete — auth directory, auth.ts, middleware.ts.
 */
export async function uninstall(): Promise<void> {
  logger.banner();
  logger.info("Removing scaffolded auth library files...");
  logger.break();

  // ── 1. Find the existing install ──────────────────────────────────
  const project = detectProject();

  if (!project.hasPackageJson) {
    logger.error(
      "No package.json found. Make sure you are running this from your project root.",
    );
    process.exit(1);
  }

  const detected = detectExistingAuthDir();

  if (!detected) {
    logger.warn(
      "Could not find an existing installation.\n" +
        "    Common locations checked: lib/auth, src/lib/auth, auth, src/auth",
    );
    process.exit(0);
  }

  logger.info(`Found installation at: ${pc.cyan(detected + "/")}`);
  logger.break();

  // ── 2. Determine which generated files exist ───────────────────────
  const nextMajor = parseMajorVersion(project.nextVersion);
  const middlewareFileName = nextMajor >= 16 ? "proxy.ts" : "middleware.ts";

  const authTsPath = project.srcDir ? "src/auth.ts" : "auth.ts";
  const middlewarePath = project.srcDir
    ? `src/${middlewareFileName}`
    : middlewareFileName;

  const authTsExists = fileExists(resolveCwd(authTsPath));
  const middlewareExists = fileExists(resolveCwd(middlewarePath));

  // ── 3. Confirm what to remove ─────────────────────────────────────
  const { confirmDir } = await prompts(
    {
      type: "confirm",
      name: "confirmDir",
      message: `Delete ${pc.red(detected + "/")} (the library files)?`,
      initial: true,
    },
    {
      onCancel: () => {
        logger.break();
        logger.error("Uninstall cancelled.");
        process.exit(0);
      },
    },
  );

  let removeAuthTs = false;
  let removeMiddleware = false;

  if (authTsExists) {
    const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Delete ${pc.red(authTsPath)} (your adapter config)?`,
      initial: false,
    });
    removeAuthTs = confirm as boolean;
  }

  if (middlewareExists) {
    const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Delete ${pc.red(middlewarePath)}?`,
      initial: false,
    });
    removeMiddleware = confirm as boolean;
  }

  if (!confirmDir && !removeAuthTs && !removeMiddleware) {
    logger.break();
    logger.warn("Nothing to remove.");
    process.exit(0);
  }

  logger.break();

  // ── 4. Remove selected files ──────────────────────────────────────
  if (confirmDir) {
    await fs.remove(resolveCwd(detected));
    logger.success(`Removed ${detected}/`);
  }

  if (removeAuthTs) {
    await fs.remove(resolveCwd(authTsPath));
    logger.success(`Removed ${authTsPath}`);
  }

  if (removeMiddleware) {
    await fs.remove(resolveCwd(middlewarePath));
    logger.success(`Removed ${middlewarePath}`);
  }

  logger.break();
  logger.dim("Uninstall complete.");
  logger.dim(
    "If you installed zod only for this library, you can remove it with your package manager.",
  );
  logger.break();
}
