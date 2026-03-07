import prompts from "prompts";
import pc from "picocolors";
import {
  detectProject,
  detectConflicts,
  parseMajorVersion,
} from "../steps/detect";
import { copyLibraryFiles } from "../steps/copy-files";
import { generateAuthFile } from "../steps/generate-auth";
import { generateMiddlewareFile } from "../steps/generate-middleware";
import { installDeps } from "../steps/install-deps";
import { logger } from "../utils/logger";

export async function init(): Promise<void> {
  logger.banner();

  // ── 1. Detect the project ─────────────────────────────────────────
  const project = detectProject();

  if (!project.hasPackageJson) {
    logger.error(
      "No package.json found in the current directory.\n" +
        "    Make sure you are running this command from your project root.",
    );
    process.exit(1);
  }

  if (!project.hasNext) {
    logger.warn(
      "Next.js was not found in your dependencies.\n" +
        "    This library requires Next.js 14+ with App Router.",
    );
    logger.break();
  }

  if (!project.hasAppRouter) {
    logger.warn(
      "No app/ directory detected — App Router is required.\n" +
        "    If you are using src/app/, that is fine and will be auto-detected.",
    );
    logger.break();
  }

  const nextMajor = parseMajorVersion(project.nextVersion);
  const middlewareFileName = nextMajor >= 16 ? "proxy.ts" : "middleware.ts";

  if (project.hasNext) {
    const version = project.nextVersion
      ? pc.gray(`(${project.nextVersion})`)
      : "";
    logger.info(
      `Detected: Next.js ${version}  ·  ` +
        `${project.hasAppRouter ? pc.green("App Router ✔") : pc.yellow("App Router?")}  ·  ` +
        `${project.hasTypeScript ? pc.green("TypeScript ✔") : pc.yellow("JavaScript")}  ·  ` +
        `${project.srcDir ? pc.cyan("src/ layout") : "root layout"}`,
    );
    logger.dim(`Package manager: ${project.packageManager}`);
    if (nextMajor >= 16) {
      logger.dim(
        `Next.js >= 16 detected — will generate proxy.ts instead of middleware.ts`,
      );
    }
    logger.break();
  }

  // ── 2. Interactive prompts ────────────────────────────────────────
  const answers = await prompts(
    [
      {
        type: "text",
        name: "authDir",
        message: "Where should the auth library be placed?",
        initial: project.srcDir ? "src/lib/auth" : "lib/auth",
        validate: (val: string) =>
          val.trim().length > 0 ? true : "Path cannot be empty",
      },
      {
        type: "confirm",
        name: "generateMiddleware",
        message: `Generate ${middlewareFileName} with route protection scaffold?`,
        initial: true,
      },
      ...(project.hasZod
        ? []
        : [
            {
              type: "confirm" as const,
              name: "installZod",
              message: `Install zod? ${pc.gray("(required peer dependency)")}`,
              initial: true,
            },
          ]),
    ],
    {
      onCancel: () => {
        logger.break();
        logger.error("Setup cancelled.");
        logger.break();
        process.exit(0);
      },
    },
  );

  if (project.hasZod) answers.installZod = false;

  logger.break();

  // ── 3. Conflict checks ────────────────────────────────────────────
  const conflicts = detectConflicts(
    answers.authDir as string,
    project.srcDir,
    nextMajor,
  );

  if (conflicts.authDirExists) {
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `${pc.yellow(answers.authDir as string)}/ already exists. Overwrite?`,
      initial: false,
    });
    if (!overwrite) {
      logger.error("Aborted — existing directory was not modified.");
      process.exit(0);
    }
    logger.break();
  }

  if (conflicts.authTsExists) {
    const { overwriteAuth } = await prompts({
      type: "confirm",
      name: "overwriteAuth",
      message: `${pc.yellow(project.srcDir ? "src/auth.ts" : "auth.ts")} already exists. Overwrite?`,
      initial: false,
    });
    answers.skipAuthTs = !overwriteAuth;
    if (answers.skipAuthTs)
      logger.warn("Skipping auth.ts — existing file preserved.");
    logger.break();
  }

  if (answers.generateMiddleware && conflicts.middlewareExists) {
    const displayName = project.srcDir
      ? `src/${middlewareFileName}`
      : middlewareFileName;
    const { overwriteMiddleware } = await prompts({
      type: "confirm",
      name: "overwriteMiddleware",
      message: `${pc.yellow(displayName)} already exists. Overwrite?`,
      initial: false,
    });
    if (!overwriteMiddleware) {
      answers.generateMiddleware = false;
      logger.warn(`Skipping ${middlewareFileName} — existing file preserved.`);
      logger.break();
    }
  }

  // ── 4. Execute ────────────────────────────────────────────────────
  logger.info("Scaffolding auth library...");
  logger.break();

  await copyLibraryFiles(answers.authDir as string);

  if (!answers.skipAuthTs) {
    await generateAuthFile(answers.authDir as string, project.srcDir);
  }

  if (answers.generateMiddleware) {
    await generateMiddlewareFile(project.srcDir, project.nextVersion);
  }

  if (answers.installZod) {
    logger.break();
    installDeps(project.packageManager, ["zod"]);
  }

  // ── 5. Done ───────────────────────────────────────────────────────
  logger.done();
  logger.nextSteps(
    answers.authDir as string,
    answers.generateMiddleware as boolean,
  );
}
