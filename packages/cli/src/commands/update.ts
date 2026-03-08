import prompts from "prompts";
import pc from "picocolors";
import path from "path";
import fs from "fs-extra";
import {
  detectProject,
  detectExistingAuthDir,
  detectTsConfigAlias,
} from "../steps/detect";
import { copyLibraryFiles } from "../steps/copy-files";
import { resolveCwd, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";

/**
 * Returns a flat list of all files under a directory, relative to that directory.
 * Used to build a before/after snapshot for the change summary.
 */
function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(path.relative(dir, fullPath));
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Compares two snapshots (before/after) and returns lists of added,
 * removed, and modified files. Content comparison is done by file size
 * as a fast proxy — good enough for a change summary, not a diff tool.
 */
function diffSnapshots(
  beforeDir: string,
  afterDir: string,
  files: string[],
): { added: string[]; removed: string[]; modified: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  const afterFiles = new Set(listFilesRecursive(afterDir));
  const beforeFiles = new Set(files);

  for (const file of afterFiles) {
    if (!beforeFiles.has(file)) {
      added.push(file);
    } else {
      // Compare file sizes as a lightweight change indicator
      const beforeSize = fs.statSync(path.join(beforeDir, file)).size;
      const afterSize = fs.statSync(path.join(afterDir, file)).size;
      if (beforeSize !== afterSize) {
        modified.push(file);
      }
    }
  }

  for (const file of beforeFiles) {
    if (!afterFiles.has(file)) {
      removed.push(file);
    }
  }

  return { added, removed, modified };
}

/**
 * `npx @ss/next-jwt-auth update [--dry-run]`
 *
 * Updates the scaffolded library files to the latest bundled templates.
 * auth.ts is NEVER overwritten — it contains your adapter implementation.
 *
 * Strategy:
 *   1. Auto-detect the existing install directory.
 *   2. If not found, ask the user where the library was installed.
 *   3. Take a snapshot of the current files.
 *   4. Copy the new templates over the existing directory.
 *   5. Report what changed (added / modified / removed).
 *
 * With --dry-run: shows what would change without writing any files.
 */
export async function update(dryRun = false): Promise<void> {
  logger.banner();
  if (dryRun) {
    logger.info("Dry run — no files will be written.");
  } else {
    logger.info("Updating scaffolded library files...");
  }
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

  let authDir: string;

  if (detected) {
    logger.info(`Found existing installation at: ${pc.cyan(detected + "/")}`);
    logger.break();

    if (!dryRun) {
      const { confirm } = await prompts({
        type: "confirm",
        name: "confirm",
        message: `Update files in ${pc.cyan(detected + "/")}?`,
        initial: true,
      });

      if (!confirm) {
        logger.break();
        logger.error("Update cancelled.");
        process.exit(0);
      }
    }

    authDir = detected;
  } else {
    logger.warn(
      "Could not auto-detect an existing installation.\n" +
        "    Common locations checked: lib/auth, src/lib/auth, auth, src/auth",
    );
    logger.break();

    const { manualDir } = await prompts(
      {
        type: "text",
        name: "manualDir",
        message: "Enter the path where the library is installed:",
        initial: project.srcDir ? "src/lib/auth" : "lib/auth",
        validate: (val: string) => {
          if (!val.trim()) return "Path cannot be empty";
          if (!fs.existsSync(resolveCwd(val))) {
            return `Directory not found: ${val}`;
          }
          return true;
        },
      },
      {
        onCancel: () => {
          logger.break();
          logger.error("Update cancelled.");
          process.exit(0);
        },
      },
    );

    authDir = manualDir as string;
  }

  logger.break();

  // ── 2. Snapshot before state ──────────────────────────────────────
  const destDir = resolveCwd(authDir);
  const beforeFiles = listFilesRecursive(destDir);

  // Source dir is the bundled template — same path copyLibraryFiles uses
  const sourceDir = path.join(__dirname, "files", "lib", "auth");

  let added: string[], removed: string[], modified: string[];

  if (dryRun) {
    // ── Dry run: diff source against dest without writing anything ────
    ({ added, removed, modified } = diffSnapshots(destDir, sourceDir, beforeFiles));
  } else {
    // ── 3. Copy new files ─────────────────────────────────────────────
    logger.step("Copying updated library files...");

    // Make a temporary copy of the current state for diffing
    const tempDir = path.join(
      require("os").tmpdir(),
      `next-jwt-auth-backup-${Date.now()}`,
    );
    await fs.copy(destDir, tempDir, { overwrite: true });

    try {
      await copyLibraryFiles(authDir);
    } catch (error) {
      // Restore original files if copy fails
      await fs.copy(tempDir, destDir, { overwrite: true });
      await fs.remove(tempDir);
      logger.error(
        `Update failed — original files restored.\n    ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    // ── 4. Report changes ─────────────────────────────────────────────
    ({ added, removed, modified } = diffSnapshots(tempDir, destDir, beforeFiles));

    // Clean up temp dir
    await fs.remove(tempDir);
  }

  logger.break();
  if (dryRun) {
    logger.info("Dry run complete — no files were modified.");
  } else {
    logger.success("Library files updated!");
  }
  logger.break();

  const totalChanges = added.length + removed.length + modified.length;

  if (totalChanges === 0) {
    logger.dim(
      dryRun
        ? "No file changes — already up to date."
        : "No file changes — you were already on the latest version.",
    );
  } else {
    if (modified.length > 0) {
      console.log(pc.bold(dryRun ? "  Would update:" : "  Updated:"));
      modified.forEach((f) => logger.dim(`${pc.yellow("~")} ${f}`));
      logger.break();
    }
    if (added.length > 0) {
      console.log(pc.bold(dryRun ? "  Would add:" : "  Added:"));
      added.forEach((f) => logger.dim(`${pc.green("+")} ${f}`));
      logger.break();
    }
    if (removed.length > 0) {
      console.log(pc.bold(dryRun ? "  Would remove:" : "  Removed:"));
      removed.forEach((f) => logger.dim(`${pc.red("-")} ${f}`));
      logger.break();
    }
  }

  // ── 5. Alias reminder ─────────────────────────────────────────────
  // auth.ts is always preserved — remind the user it was not touched
  const authTsPath = project.srcDir ? "src/auth.ts" : "auth.ts";
  if (!dryRun && fileExists(resolveCwd(authTsPath))) {
    logger.dim(
      `${pc.green("✔")} ${authTsPath} preserved — your adapter was not modified.`,
    );
    logger.break();
  }

  const alias = detectTsConfigAlias();
  logger.dim(`Import alias in use: ${pc.cyan(alias)}`);
  logger.dim(
    "If your import alias has changed since you ran init, re-run " +
      pc.cyan("npx @ss/next-jwt-auth init") +
      " to regenerate auth.ts and middleware.ts.",
  );
  logger.break();
}
