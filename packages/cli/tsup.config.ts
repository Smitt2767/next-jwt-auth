import { defineConfig } from "tsup";
import fs from "fs-extra";
import path from "path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  shims: true,
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
