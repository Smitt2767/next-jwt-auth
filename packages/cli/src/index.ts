import { init } from "./commands/init";
import { update } from "./commands/update";
import { check } from "./commands/check";
import { uninstall } from "./commands/uninstall";
import { addOAuth } from "./commands/add-oauth";

// Injected at build time from the root monorepo package.json by tsup's `define`
declare const __LIB_VERSION__: string;

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === "init") {
    const clean = args.includes("--clean");
    await init(clean);
  } else if (command === "update") {
    const dryRun = args.includes("--dry-run");
    await update(dryRun);
  } else if (command === "check") {
    await check();
  } else if (command === "uninstall") {
    await uninstall();
  } else if (command === "add" && args[1] === "oauth") {
    await addOAuth();
  } else if (command === "--help" || command === "-h") {
    console.log("");
    console.log(
      "  @smittdev/next-jwt-auth — JWT auth scaffolder for Next.js App Router",
    );
    console.log("");
    console.log("  Usage:");
    console.log(
      "    npx @smittdev/next-jwt-auth init               Scaffold auth into your project",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth init --clean       Scaffold without JSDoc comments",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth add oauth          Add OAuth provider support (Google, GitHub)",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth update             Update library files to the latest version",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth update --dry-run   Preview changes without writing any files",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth check              Validate your project setup",
    );
    console.log(
      "    npx @smittdev/next-jwt-auth uninstall          Remove scaffolded auth files from the project",
    );
    console.log("");
  } else if (command === "--version" || command === "-v") {
    console.log(__LIB_VERSION__);
  } else {
    console.error(`  Unknown command: ${command}`);
    console.log("  Run  npx @smittdev/next-jwt-auth --help  for usage");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  Fatal error: ${message}\n`);
  process.exit(1);
});
