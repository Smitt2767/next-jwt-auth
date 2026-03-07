// lib/auth/config.ts
//
// Module-level singleton that holds the resolved auth configuration.
// `Auth()` calls `setGlobalAuthConfig()` once at startup.
// Every internal module then calls `getGlobalAuthConfig()` instead of
// receiving config as a constructor argument, keeping function signatures clean.

import type { ResolvedAuthConfig } from "./types";

let _config: ResolvedAuthConfig | null = null;

/**
 * Stores the resolved config globally. Called once by `Auth()`.
 * Subsequent calls (e.g. hot reload in dev) safely overwrite the existing value.
 */
export function setGlobalAuthConfig(config: ResolvedAuthConfig): void {
  _config = config;
}

/**
 * Returns the resolved config.
 * Throws a descriptive error if `Auth()` was never called — catches the
 * "forgot to initialize" mistake early with a clear message.
 */
export function getGlobalAuthConfig(): ResolvedAuthConfig {
  if (!_config) {
    throw new Error(
      "[next-jwt-auth] Auth has not been initialized.\n" +
        "Make sure `Auth()` is called in your auth.ts and that file is imported " +
        "before any auth utilities are used (e.g. in your root layout).",
    );
  }
  return _config;
}
