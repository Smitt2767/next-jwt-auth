import { init } from "./commands/init";
import { update } from "./commands/update";
import { check } from "./commands/check";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === "init") {
    await init();
  } else if (command === "update") {
    await update();
  } else if (command === "check") {
    await check();
  } else if (command === "--help" || command === "-h") {
    console.log("");
    console.log(
      "  @ss/next-jwt-auth — JWT auth scaffolder for Next.js App Router",
    );
    console.log("");
    console.log("  Usage:");
    console.log(
      "    npx @ss/next-jwt-auth init      Scaffold auth into your project",
    );
    console.log(
      "    npx @ss/next-jwt-auth update    Update library files to the latest version",
    );
    console.log(
      "    npx @ss/next-jwt-auth check     Validate your project setup",
    );
    console.log("");
  } else if (command === "--version" || command === "-v") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../package.json") as { version: string };
    console.log(pkg.version);
  } else {
    console.error(`  Unknown command: ${command}`);
    console.log("  Run  npx @ss/next-jwt-auth --help  for usage");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  Fatal error: ${message}\n`);
  process.exit(1);
});
