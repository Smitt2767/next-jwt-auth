import { fileExists, dirExists, readJson, resolveCwd } from "../utils/fs";
import { readMetadata, writeMetadata, createMetadata } from "./write-metadata";

// ─── Version parsing ──────────────────────────────────────────────────────────

/** Parses the major version number from a semver string like "^15.0.0" → 15 */
export function parseMajorVersion(versionStr: string | null): number {
  if (!versionStr) return 0;
  const cleaned = versionStr.replace(/^[\^~>=<\s]+/, "");
  const major = parseInt(cleaned.split(".")[0], 10);
  return isNaN(major) ? 0 : major;
}

// ─── Project detection ────────────────────────────────────────────────────────

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

// ─── tsconfig alias detection ─────────────────────────────────────────────────

/**
 * Reads tsconfig.json and returns the import alias prefix configured for the
 * project (e.g. "@/", "~/", "#/").
 *
 * Strategy:
 *   1. Read compilerOptions.paths from tsconfig.json (and tsconfig.*.json if extended).
 *   2. Find the first path alias whose value maps to "./*" or "./src/*".
 *   3. Strip the trailing "*" from the alias key to get the prefix.
 *   4. Fall back to "@/" if nothing is found — this covers the Next.js default.
 *
 * @example
 * // tsconfig.json paths: { "@/*": ["./src/*"] }  →  "@/"
 * // tsconfig.json paths: { "~/*": ["./*"] }       →  "~/"
 * // no paths configured                           →  "@/"
 */
export function detectTsConfigAlias(): string {
  const tsconfigPath = resolveCwd("tsconfig.json");
  if (!fileExists(tsconfigPath)) return "@/";

  const tsconfig = readJson(tsconfigPath);
  if (!tsconfig) return "@/";

  const paths = (tsconfig?.compilerOptions as Record<string, unknown>)
    ?.paths as Record<string, string[]> | undefined;

  if (!paths || typeof paths !== "object") return "@/";

  // Target mappings that indicate a root-level path alias
  const rootMappings = ["./*", "./src/*", "src/*"];

  for (const [aliasPattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) continue;

    const mapsToRoot = targets.some((t) => rootMappings.includes(t));
    if (!mapsToRoot) continue;

    // aliasPattern is something like "@/*" or "~/*" — strip the trailing "*"
    if (aliasPattern.endsWith("*")) {
      return aliasPattern.slice(0, -1); // "@/*" → "@/"
    }
  }

  return "@/";
}

// ─── Existing install detection ───────────────────────────────────────────────

/**
 * Attempts to find an existing next-jwt-auth installation in the project by
 * looking for known marker files in common locations.
 *
 * Returns the directory path relative to cwd (e.g. "lib/auth" or "src/lib/auth"),
 * or null if no existing installation is found.
 *
 * Used by the `update` command to auto-detect the install location so the user
 * doesn't have to remember where they put it.
 */
export function detectExistingAuthDir(): string | null {
  // These are the marker files we look for — if any of them exist inside a
  // candidate directory, we treat that directory as the install location.
  const markerFile = "index.ts";

  const candidates = [
    "lib/auth",
    "src/lib/auth",
    "app/lib/auth",
    "src/app/lib/auth",
    "auth",
    "src/auth",
  ];

  for (const candidate of candidates) {
    if (fileExists(resolveCwd(candidate, markerFile))) {
      return candidate;
    }
  }

  return null;
}

// ─── Metadata-aware install detection ────────────────────────────────────────

export interface ExistingInstall {
  /** Relative path to the auth lib dir, e.g. "lib/auth" */
  libDir: string;
  /** Whether a metadata.json was found (vs. inferred from file scan) */
  hadMetadata: boolean;
}

/**
 * Finds an existing next-jwt-auth installation.
 *
 * Strategy:
 *   1. Scan common candidate dirs for a metadata.json — this is the v1.1.0+ path.
 *   2. Fall back to detectExistingAuthDir() (index.ts file scan) for v1.0.0 users.
 *      In that case, infer config and silently create metadata.json.
 *
 * Returns null if no installation is found.
 */
export async function detectExistingInstall(): Promise<ExistingInstall | null> {
  const candidates = [
    "lib/auth",
    "src/lib/auth",
    "app/lib/auth",
    "src/app/lib/auth",
    "auth",
    "src/auth",
  ];

  // 1. Check for metadata.json in all candidate dirs
  for (const candidate of candidates) {
    const meta = readMetadata(candidate);
    if (meta) {
      return { libDir: meta.config.libDir, hadMetadata: true };
    }
  }

  // 2. Fall back to file-scan (v1.0.0 backward compat)
  const libDir = detectExistingAuthDir();
  if (!libDir) return null;

  // Infer config from project state and silently create metadata.json
  const alias = detectTsConfigAlias();
  const srcDir = libDir.startsWith("src/");
  const middlewareType = fileExists(resolveCwd("src", "proxy.ts")) ||
    fileExists(resolveCwd("proxy.ts"))
    ? "proxy" as const
    : "middleware" as const;

  const metadata = createMetadata({
    libDir,
    alias,
    srcDir,
    hasAuthTs: fileExists(resolveCwd(srcDir ? "src/auth.ts" : "auth.ts")),
    hasMiddleware:
      fileExists(resolveCwd(srcDir ? `src/${middlewareType}.ts` : `${middlewareType}.ts`)),
    middlewareType,
  });

  await writeMetadata(libDir, metadata);

  return { libDir, hadMetadata: false };
}
