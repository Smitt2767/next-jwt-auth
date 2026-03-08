import { defineConfig } from "tsup";
import fs from "fs-extra";
import path from "path";

// Root monorepo package.json is the single source of truth for the lib version
const rootPkg = fs.readJsonSync(path.join(__dirname, "..", "..", "package.json")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  shims: true,
  // Inject the lib version from the root package.json at build time
  define: {
    __LIB_VERSION__: JSON.stringify(rootPkg.version),
  },
  // The shebang is added via banner so the output is directly executable
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    // Copy the library template files into dist so they're available
    // at runtime when someone runs `npx @ss/next-jwt-auth init`
    fs.copySync(
      path.join(__dirname, "files"),
      path.join(__dirname, "dist", "files"),
      { overwrite: true },
    );
    console.log("✔ Copied library files to dist/files/");
  },
});
