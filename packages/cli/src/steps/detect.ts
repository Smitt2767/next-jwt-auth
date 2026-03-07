import { fileExists, dirExists, readJson, resolveCwd } from "../utils/fs";

/** Parses the major version number from a semver string like "^15.0.0" → 15 */
export function parseMajorVersion(versionStr: string | null): number {
  if (!versionStr) return 0;
  const cleaned = versionStr.replace(/^[\^~>=<\s]+/, "");
  const major = parseInt(cleaned.split(".")[0], 10);
  return isNaN(major) ? 0 : major;
}

export interface ProjectInfo {
  /** Whether a package.json was found in cwd */
  hasPackageJson: boolean;
  /** Whether next is listed as a dependency */
  hasNext: boolean;
  /** Whether an app/ or src/app/ directory exists */
  hasAppRouter: boolean;
  /** Whether a tsconfig.json exists */
  hasTypeScript: boolean;
  /** Whether zod is already installed */
  hasZod: boolean;
  /** Detected package manager based on lockfile */
  packageManager: "pnpm" | "yarn" | "npm";
  /** Raw next version string from package.json */
  nextVersion: string | null;
  /** Whether the project uses a src/ directory layout */
  srcDir: boolean;
}

export interface ConflictInfo {
  authDirExists: boolean;
  authTsExists: boolean;
  middlewareExists: boolean;
}

/**
 * Inspects the current working directory and returns information
 * about the project structure and existing files.
 */
export function detectProject(): ProjectInfo {
  const hasPackageJson = fileExists(resolveCwd("package.json"));
  const pkg = hasPackageJson ? readJson(resolveCwd("package.json")) : null;

  const deps: Record<string, string> = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };

  const hasNext = "next" in deps;
  const nextVersion = typeof deps["next"] === "string" ? deps["next"] : null;
  const hasZod = "zod" in deps;

  // App Router detection — check both src/app and app
  const hasSrcApp = dirExists(resolveCwd("src", "app"));
  const hasRootApp = dirExists(resolveCwd("app"));
  const hasAppRouter = hasSrcApp || hasRootApp;
  // Prefer src/ layout if src/app exists and root app doesn't
  const srcDir = hasSrcApp && !hasRootApp;

  const hasTypeScript = fileExists(resolveCwd("tsconfig.json"));

  // Detect package manager by lockfile presence
  const packageManager: ProjectInfo["packageManager"] = fileExists(
    resolveCwd("pnpm-lock.yaml"),
  )
    ? "pnpm"
    : fileExists(resolveCwd("yarn.lock"))
      ? "yarn"
      : "npm";

  return {
    hasPackageJson,
    hasNext,
    hasAppRouter,
    hasTypeScript,
    hasZod,
    packageManager,
    nextVersion,
    srcDir,
  };
}

/**
 * Checks for files that would be overwritten by the scaffold.
 * Called after prompts so we know the target authDir and project layout.
 */
export function detectConflicts(
  targetDir: string,
  srcDir: boolean,
  nextMajorVersion: number,
): ConflictInfo {
  const authTsPath = srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");

  const middlewareFileName =
    nextMajorVersion >= 16 ? "proxy.ts" : "middleware.ts";
  const middlewarePath = srcDir
    ? resolveCwd("src", middlewareFileName)
    : resolveCwd(middlewareFileName);

  return {
    authDirExists: dirExists(resolveCwd(targetDir)),
    authTsExists: fileExists(authTsPath),
    middlewareExists: fileExists(middlewarePath),
  };
}
