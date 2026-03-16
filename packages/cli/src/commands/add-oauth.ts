import prompts from "prompts";
import pc from "picocolors";
import fs from "fs-extra";
import { detectProject, detectExistingInstall } from "../steps/detect";
import { readMetadata, writeMetadata, mergeMetadata } from "../steps/write-metadata";
import { copyOAuthFiles, type ProviderId } from "../steps/copy-oauth-files";
import { generateOAuthRoute } from "../steps/generate-route";
import { logger } from "../utils/logger";
import { resolveCwd } from "../utils/fs";
import { stripJsDoc } from "../utils/strip-jsdoc";

const ALL_PROVIDERS: { id: ProviderId; label: string; envVars: string[] }[] = [
  {
    id: "google",
    label: "Google",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    id: "github",
    label: "GitHub",
    envVars: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  },
];

export async function addOAuth(): Promise<void> {
  logger.break();
  console.log(
    "  " + pc.bold(pc.cyan("@smittdev/next-jwt-auth")) + pc.gray("  add oauth"),
  );
  console.log(
    pc.gray("  Add OAuth provider support to your Next.js app"),
  );
  logger.break();

  // ── 1. Verify project ──────────────────────────────────────────────
  const project = detectProject();
  if (!project.hasPackageJson) {
    logger.error(
      "No package.json found in the current directory.\n" +
        "    Make sure you are running this command from your project root.",
    );
    process.exit(1);
  }

  // ── 2. Find existing installation ─────────────────────────────────
  const install = await detectExistingInstall();
  if (!install) {
    logger.error(
      "No next-jwt-auth installation found.\n" +
        `    Run ${pc.cyan("npx @smittdev/next-jwt-auth init")} first.`,
    );
    process.exit(1);
  }

  const { libDir } = install;

  if (!install.hadMetadata) {
    logger.dim(
      "Created metadata.json from existing installation (1.0.0 → 1.1.0 migration)",
    );
    logger.break();
  }

  const metadata = readMetadata(libDir);
  if (!metadata) {
    logger.error(`Could not read metadata.json from ${libDir}/`);
    process.exit(1);
  }

  const alreadyInstalled = metadata.features.oauth.providers as ProviderId[];

  logger.info(`Auth library found at: ${pc.cyan(libDir + "/")}`);
  if (alreadyInstalled.length > 0) {
    logger.info(`Installed providers: ${alreadyInstalled.join(", ")}`);
  }
  logger.break();

  // ── 3. Provider selection ──────────────────────────────────────────
  const available = ALL_PROVIDERS.filter((p) => !alreadyInstalled.includes(p.id));

  if (available.length === 0) {
    logger.info("All supported providers are already installed.");
    logger.break();
    process.exit(0);
  }

  const { selectedIds } = await prompts(
    {
      type: "multiselect",
      name: "selectedIds",
      message: "Which OAuth providers would you like to add?",
      choices: available.map((p) => ({
        title: p.label,
        value: p.id,
      })),
      min: 1,
      hint: "Space to select, Enter to confirm",
    },
    {
      onCancel: () => {
        logger.break();
        logger.error("Cancelled.");
        logger.break();
        process.exit(0);
      },
    },
  );

  const newProviders = selectedIds as ProviderId[];
  const allProviders = [...alreadyInstalled, ...newProviders];

  logger.break();

  const clean = metadata.config.clean ?? false;

  // ── 4. Copy OAuth files ────────────────────────────────────────────
  logger.step("Copying OAuth provider files...");
  await copyOAuthFiles(libDir, allProviders, clean);

  // ── 5. Generate catch-all route ────────────────────────────────────
  logger.step("Generating OAuth route...");
  await generateOAuthRoute(metadata.config.alias);

  // ── 6. Patch auth.ts ──────────────────────────────────────────────
  logger.break();
  const authTsPath = metadata.config.srcDir
    ? resolveCwd("src", "auth.ts")
    : resolveCwd("auth.ts");

  const authTsDisplay = metadata.config.srcDir ? "src/auth.ts" : "auth.ts";

  const patchSnippet = buildAuthTsPatch(
    newProviders,
    libDir,
    metadata.config.alias,
    metadata.config.srcDir,
    clean,
  );

  console.log(
    pc.bold("  Preview — changes to add to ") + pc.cyan(authTsDisplay) + ":",
  );
  logger.break();
  console.log(pc.gray(indent(patchSnippet, 4)));
  logger.break();

  const { doPatch } = await prompts({
    type: "confirm",
    name: "doPatch",
    message: `Automatically patch ${authTsDisplay}?`,
    initial: true,
  });

  if (doPatch) {
    await patchAuthTs(authTsPath, patchSnippet);
    logger.success(`Patched ${authTsDisplay}`);
  } else {
    logger.break();
    logger.warn(
      `Skipping auto-patch. Add the following to ${authTsDisplay} manually:`,
    );
    logger.break();
    console.log(patchSnippet);
  }

  // ── 7. Update metadata ────────────────────────────────────────────
  const updated = mergeMetadata(metadata, {
    files: { ...metadata.files, hasOAuthRoute: true },
    features: {
      oauth: {
        enabled: true,
        providers: allProviders,
      },
    },
  });
  await writeMetadata(libDir, updated);

  // ── 8. Next steps ─────────────────────────────────────────────────
  logger.break();
  console.log("  " + pc.bold(pc.green("✔ OAuth setup complete!")));
  logger.break();
  printNextSteps(newProviders, metadata.config.srcDir);
}

// ─── Auth.ts patch helpers ─────────────────────────────────────────────────

/**
 * Builds the snippet that should be appended to / merged into auth.ts.
 * Shows provider imports + providers array + oauthLogin stub.
 */
function buildAuthTsPatch(
  providers: ProviderId[],
  libDir: string,
  alias: string,
  srcDir: boolean,
  clean = false,
): string {
  // Strip leading "src/" from import path (tsconfig maps alias to src/)
  const importSegment =
    srcDir && libDir.startsWith("src/") ? libDir.slice("src/".length) : libDir;
  const providersImportPath = `${alias}${importSegment}/providers`;

  const providerImports = providers
    .map((id) => {
      const cls = providerClass(id);
      return `import { ${cls} } from "${providersImportPath}";`;
    })
    .join("\n");

  const providerInstances = providers
    .map((id) => {
      const cls = providerClass(id);
      const upper = id.toUpperCase();
      return `    new ${cls}({
      clientId: process.env.${upper}_CLIENT_ID!,
      clientSecret: process.env.${upper}_CLIENT_SECRET!,
    }),`;
    })
    .join("\n");

  const oauthLoginStubRaw = `
    /**
     * Called after a successful OAuth login.
     * \`provider\` is the provider id (e.g. "google", "github").
     * \`userInfo\` contains the user's profile from the OAuth provider.
     * Must return { accessToken, refreshToken } or throw an Error.
     */
    async oauthLogin(provider, userInfo) {
      throw new Error("oauthLogin() not implemented — edit auth.ts to connect your API");
    },`;
  const oauthLoginStub = clean ? stripJsDoc(oauthLoginStubRaw) : oauthLoginStubRaw;

  return `${providerImports}

// Add to your Auth({...}) call:
// providers: [
${providerInstances.split("\n").map((l) => `//   ${l}`).join("\n")}
// ],
//
// Add to your adapter:
// adapter: {
//   ...existingAdapter,${oauthLoginStub.split("\n").map((l) => `//   ${l}`).join("\n")}
// },
`;
}

/**
 * Appends the patch snippet to the end of auth.ts, just before the closing `});`
 * if found — otherwise appends at the end of the file.
 */
async function patchAuthTs(
  authTsPath: string,
  snippet: string,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(authTsPath, "utf-8");
  } catch {
    // auth.ts doesn't exist — skip silently, user is warned
    return;
  }

  // Find the last occurrence of `});` to insert before it
  const marker = "});";
  const lastIdx = content.lastIndexOf(marker);
  if (lastIdx !== -1) {
    content =
      content.slice(0, lastIdx) +
      "\n" +
      snippet +
      "\n" +
      content.slice(lastIdx);
  } else {
    content += "\n" + snippet;
  }

  await fs.writeFile(authTsPath, content, "utf-8");
}

// ─── Util ──────────────────────────────────────────────────────────────────

function providerClass(id: ProviderId): string {
  return id === "google" ? "GoogleProvider" : "GitHubProvider";
}

function indent(str: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return str
    .split("\n")
    .map((l) => (l.trim() ? pad + l : l))
    .join("\n");
}

// ─── Next steps output ─────────────────────────────────────────────────────

function printNextSteps(providers: ProviderId[], srcDir: boolean): void {
  const routePath = srcDir
    ? "src/app/api/auth/[...oauth]/route.ts"
    : "app/api/auth/[...oauth]/route.ts";

  console.log(pc.bold("  Next steps:"));
  logger.break();
  console.log(`  1. Implement ${pc.cyan("oauthLogin()")} in auth.ts to call your backend API.`);
  logger.break();
  console.log(`  2. Add env vars to ${pc.cyan(".env.local")}:`);
  logger.break();

  for (const p of providers) {
    const info = ALL_PROVIDERS.find((x) => x.id === p)!;
    for (const v of info.envVars) {
      logger.dim(`${v}=`);
    }
    logger.break();
  }

  console.log("  3. Register callback URL(s) with each provider:");
  logger.break();
  for (const p of providers) {
    logger.dim(
      `http://localhost:3000/api/auth/${p}/callback  (${p})`,
    );
  }
  logger.break();
  console.log(
    `  4. OAuth route is ready at: ${pc.cyan(routePath)}`,
  );
  logger.break();
  console.log("  Client usage:");
  logger.dim(
    `const { oauthLogin } = useAuth();`,
  );
  logger.dim(
    `<button onClick={() => oauthLogin("${providers[0] ?? "google"}")}>Login with ${ALL_PROVIDERS.find((x) => x.id === providers[0])?.label ?? "OAuth"}</button>`,
  );
  logger.break();
}
