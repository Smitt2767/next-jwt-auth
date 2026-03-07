import pc from "picocolors";

export const logger = {
  info: (msg: string) => console.log(pc.cyan("  ℹ ") + msg),
  success: (msg: string) => console.log(pc.green("  ✔ ") + msg),
  warn: (msg: string) => console.log(pc.yellow("  ⚠ ") + msg),
  error: (msg: string) => console.log(pc.red("  ✖ ") + msg),
  step: (msg: string) => console.log(pc.blue("  → ") + msg),
  dim: (msg: string) => console.log(pc.gray("    " + msg)),
  break: () => console.log(),

  banner() {
    console.log();
    console.log(
      "  " +
        pc.bold(pc.cyan("@ss/next-jwt-auth")) +
        pc.gray("  v0.1.0"),
    );
    console.log(
      pc.gray("  JWT authentication scaffolder for Next.js App Router"),
    );
    console.log();
  },

  done() {
    console.log();
    console.log("  " + pc.bold(pc.green("✔ Auth scaffold complete!")));
    console.log();
  },

  nextSteps(authDir: string, hasMiddleware: boolean) {
    console.log(pc.bold("  Next steps:"));
    console.log();
    console.log(
      "  1. Open " +
        pc.cyan("auth.ts") +
        " and implement your three adapter functions",
    );
    console.log(
      "     " + pc.gray("login()  ·  refreshToken()  ·  fetchUser()"),
    );
    console.log();
    console.log(
      "  2. Wrap your root layout with " +
        pc.cyan("<AuthProvider actions={auth.actions}>"),
    );
    console.log();
    console.log(
      "  3. Use server helpers in Server Components:",
    );
    console.log(
      "     " + pc.cyan(`import { auth } from "@/auth"`),
    );
    console.log(
      "     " + pc.gray("auth.getSession()  ·  auth.requireSession()  ·  auth.getUser()"),
    );
    console.log();
    if (hasMiddleware) {
      console.log(
        "  4. Edit " +
          pc.cyan("middleware.ts") +
          " to configure your protected and public routes",
      );
      console.log();
    }
    console.log(
      "  " +
        pc.gray("Library installed at: ") +
        pc.cyan(authDir + "/"),
    );
    console.log();
  },
};
