import { execSync } from "child_process";
import { logger } from "../utils/logger";

/**
 * Installs the given packages using the detected package manager.
 * Falls back to a printed command if installation fails.
 */
export function installDeps(
  packageManager: "pnpm" | "yarn" | "npm",
  packages: string[],
): void {
  if (packages.length === 0) return;

  const cmd =
    packageManager === "pnpm"
      ? `pnpm add ${packages.join(" ")}`
      : packageManager === "yarn"
        ? `yarn add ${packages.join(" ")}`
        : `npm install ${packages.join(" ")}`;

  logger.step(`Installing dependencies: ${packages.join(", ")}`);

  try {
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
    logger.success(`Installed: ${packages.join(", ")}`);
  } catch {
    logger.error(`Auto-install failed. Run this manually:\n\n    ${cmd}\n`);
  }
}
