import pc from "picocolors";
import fs from "fs-extra";
import {
  detectProject,
  detectExistingAuthDir,
  detectTsConfigAlias,
} from "../steps/detect";
import { resolveCwd, fileExists } from "../utils/fs";
import { logger } from "../utils/logger";

// ─── Result types ─────────────────────────────────────────────────────────────

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface CheckResult {
  label: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function printResult(result: CheckResult): void {
  const icon =
    result.status === "pass"
      ? pc.green("  ✔")
      : result.status === "warn"
        ? pc.yellow("  ⚠")
        : result.status === "fail"
          ? pc.red("  ✖")
          : pc.gray("  –");

  const label =
    result.status === "pass"
      ? pc.white(result.label)
      : result.status === "warn"
        ? pc.yellow(result.label)
        : result.status === "fail"
          ? pc.red(result.label)
          : pc.gray(result.label);

  console.log(`${icon}  ${label}`);

  if (result.detail) {
    console.log(`       ${pc.gray(result.detail)}`);
  }
  if (result.hint) {
    console.log(`       ${pc.cyan("→")} ${pc.gray(result.hint)}`);
  }
}

// ─── Individual checks ────────────────────────────────────────────────────────

/**
 * CHECK 1 — Library directory exists
 */
function checkAuthDirExists(authDir: string | null): CheckResult {
  if (!authDir) {
    return {
      label: "Library installation not found",
      status: "fail",
      detail: "Checked: lib/auth, src/lib/auth, auth, src/auth",
      hint: "Run: npx @ss/next-jwt-auth init",
    };
  }
  return {
    label: `Library found at ${authDir}/`,
    status: "pass",
  };
}

/**
 * CHECK 2 — auth.ts exists at the project root (or src/)
 */
function checkAuthTsExists(srcDir: boolean): CheckResult {
  const authTsPath = srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");
  const displayPath = srcDir ? "src/auth.ts" : "auth.ts";

  if (!fileExists(authTsPath)) {
    return {
      label: `${displayPath} not found`,
      status: "fail",
      hint: "Run: npx @ss/next-jwt-auth init  (it generates auth.ts for you)",
    };
  }
  return {
    label: `${displayPath} exists`,
    status: "pass",
  };
}

/**
 * CHECK 3 — auth.ts adapter functions are implemented (not just throwing stubs)
 *
 * We look for the stub error messages injected by the scaffolder. If we find
 * any, it means the user hasn't wired up their API yet.
 */
function checkAdapterImplemented(srcDir: boolean): CheckResult {
  const authTsPath = srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");
  const displayPath = srcDir ? "src/auth.ts" : "auth.ts";

  const content = readFileSafe(authTsPath);
  if (!content) {
    return {
      label: "Adapter implementation check skipped",
      status: "skip",
      detail: `${displayPath} could not be read`,
    };
  }

  const stubs = [
    { fn: "login()", marker: "login() not implemented" },
    { fn: "refreshToken()", marker: "refreshToken() not implemented" },
    { fn: "fetchUser()", marker: "fetchUser() not implemented" },
  ];

  const unimplemented = stubs
    .filter(({ marker }) => content.includes(marker))
    .map(({ fn }) => fn);

  if (unimplemented.length === 0) {
    return {
      label: "Adapter functions implemented",
      status: "pass",
    };
  }

  return {
    label: `Adapter stubs not yet implemented: ${unimplemented.join(", ")}`,
    status: "warn",
    hint: `Open ${displayPath} and replace the throw stubs with your API calls`,
  };
}

/**
 * CHECK 4 — AuthProvider is present in a layout file
 *
 * We scan common layout file locations for an AuthProvider import or usage.
 * This is a heuristic, not a guarantee — we check for the string "AuthProvider".
 */
function checkAuthProviderInLayout(srcDir: boolean): CheckResult {
  const layoutCandidates = srcDir
    ? [
        resolveCwd("src", "app", "layout.tsx"),
        resolveCwd("src", "app", "layout.ts"),
      ]
    : [resolveCwd("app", "layout.tsx"), resolveCwd("app", "layout.ts")];

  for (const layoutPath of layoutCandidates) {
    const content = readFileSafe(layoutPath);
    if (!content) continue;

    if (content.includes("AuthProvider")) {
      return {
        label: "AuthProvider found in root layout",
        status: "pass",
      };
    }

    // Layout exists but AuthProvider isn't there
    return {
      label: "AuthProvider not found in root layout",
      status: "warn",
      detail: `Found layout at ${layoutPath.replace(resolveCwd(), ".")} but AuthProvider is missing`,
      hint: "Wrap your layout's children with <AuthProvider actions={auth.actions}>",
    };
  }

  return {
    label: "Root layout check skipped",
    status: "skip",
    detail: "Could not find app/layout.tsx or src/app/layout.tsx",
  };
}

/**
 * CHECK 5 — middleware.ts (or proxy.ts) exists and has the correct matcher
 */
function checkMiddleware(srcDir: boolean, nextMajor: number): CheckResult {
  const fileName = nextMajor >= 16 ? "proxy.ts" : "middleware.ts";
  const middlewarePath = srcDir
    ? resolveCwd("src", fileName)
    : resolveCwd(fileName);
  const displayPath = srcDir ? `src/${fileName}` : fileName;

  if (!fileExists(middlewarePath)) {
    return {
      label: `${displayPath} not found`,
      status: "warn",
      detail:
        "Without middleware, tokens won't be silently refreshed between page navigations",
      hint: `Run: npx @ss/next-jwt-auth init  and choose to generate ${fileName}`,
    };
  }

  const content = readFileSafe(middlewarePath);
  if (!content) {
    return {
      label: `${displayPath} exists (could not read)`,
      status: "skip",
    };
  }

  // Check the matcher is present and not empty
  const hasCreateMiddleware = content.includes("createMiddleware");
  const hasMatcher = content.includes("matcher");
  const hasSessionResponse = content.includes("session.response");

  if (!hasCreateMiddleware) {
    return {
      label: `${displayPath} found but createMiddleware() is missing`,
      status: "warn",
      detail:
        "The middleware won't refresh tokens without calling auth.createMiddleware()",
      hint: "Re-generate with: npx @ss/next-jwt-auth init",
    };
  }

  if (!hasSessionResponse) {
    return {
      label: `${displayPath} found but session.response() is missing`,
      status: "warn",
      detail:
        "Token cookies won't be written back without wrapping your response",
      hint: "Return session.response(NextResponse.next()) instead of NextResponse.next()",
    };
  }

  if (!hasMatcher) {
    return {
      label: `${displayPath} found but config.matcher is missing`,
      status: "warn",
      hint: 'Add: export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] }',
    };
  }

  return {
    label: `${displayPath} looks correct`,
    status: "pass",
  };
}

/**
 * CHECK 6 — tsconfig import alias matches what's in auth.ts
 *
 * If the user changed their tsconfig alias after running init, their auth.ts
 * import path will be stale and TypeScript will error.
 */
function checkImportAlias(srcDir: boolean): CheckResult {
  const detectedAlias = detectTsConfigAlias();
  const authTsPath = srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");
  const displayPath = srcDir ? "src/auth.ts" : "auth.ts";

  const content = readFileSafe(authTsPath);
  if (!content) {
    return {
      label: "Import alias check skipped",
      status: "skip",
      detail: `${displayPath} could not be read`,
    };
  }

  // Extract the import path from:  import { Auth } from "ALIAS/..."
  const match = content.match(/from\s+["']([^"']+)["']/);
  if (!match) {
    return {
      label: "Import alias check skipped",
      status: "skip",
      detail: "Could not parse import path from auth.ts",
    };
  }

  const usedAlias = match[1].replace(/lib\/auth.*$/, "").replace(/auth.*$/, "");

  if (usedAlias === detectedAlias) {
    return {
      label: `Import alias matches tsconfig (${pc.cyan(detectedAlias)})`,
      status: "pass",
    };
  }

  return {
    label: "Import alias mismatch",
    status: "warn",
    detail: `auth.ts uses "${usedAlias}" but tsconfig.json configures "${detectedAlias}"`,
    hint: "Re-run: npx @ss/next-jwt-auth init  to regenerate auth.ts with the correct alias",
  };
}

// ─── Command ──────────────────────────────────────────────────────────────────

/**
 * `npx @ss/next-jwt-auth check`
 *
 * Validates the project's next-jwt-auth setup and reports any issues.
 * Exits with code 1 if any checks fail, 0 if all pass or warn.
 */
export async function check(): Promise<void> {
  logger.banner();
  console.log(pc.bold("  Checking your next-jwt-auth setup...\n"));

  const project = detectProject();

  if (!project.hasPackageJson) {
    logger.error("No package.json found. Run from your project root.");
    process.exit(1);
  }

  const nextMajor = parseInt(
    (project.nextVersion ?? "0").replace(/^[\^~>=<\s]+/, "").split(".")[0],
    10,
  );

  const authDir = detectExistingAuthDir();

  const results: CheckResult[] = [
    checkAuthDirExists(authDir),
    checkAuthTsExists(project.srcDir),
    checkAdapterImplemented(project.srcDir),
    checkAuthProviderInLayout(project.srcDir),
    checkMiddleware(project.srcDir, isNaN(nextMajor) ? 0 : nextMajor),
    checkImportAlias(project.srcDir),
  ];

  results.forEach(printResult);
  logger.break();

  // ── Summary ───────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "pass").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  const parts: string[] = [];
  if (passed) parts.push(pc.green(`${passed} passed`));
  if (warned)
    parts.push(pc.yellow(`${warned} warning${warned > 1 ? "s" : ""}`));
  if (failed) parts.push(pc.red(`${failed} failed`));
  if (skipped) parts.push(pc.gray(`${skipped} skipped`));

  console.log(`  ${parts.join(pc.gray("  ·  "))}`);
  logger.break();

  if (failed > 0) {
    process.exit(1);
  }
}
