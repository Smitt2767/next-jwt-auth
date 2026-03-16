import fs from "fs-extra";
import path from "path";
import { resolveCwd } from "../utils/fs";

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface AuthMetadata {
  version: string;
  installedAt: string;
  updatedAt: string;
  config: {
    libDir: string;
    alias: string;
    srcDir: boolean;
    clean: boolean;
  };
  files: {
    hasAuthTs: boolean;
    hasMiddleware: boolean;
    middlewareType: "middleware" | "proxy";
    hasOAuthRoute: boolean;
  };
  features: {
    oauth: {
      enabled: boolean;
      providers: string[];
    };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Injected at build time by tsup's `define`
declare const __LIB_VERSION__: string;

function metadataPath(libDir: string): string {
  return resolveCwd(libDir, "metadata.json");
}

/**
 * Reads metadata.json from the given libDir. Returns null if not found or invalid.
 */
export function readMetadata(libDir: string): AuthMetadata | null {
  const filePath = metadataPath(libDir);
  try {
    const raw = fs.readJsonSync(filePath) as AuthMetadata;
    if (!raw || typeof raw.version !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Writes (creates or overwrites) metadata.json at the given libDir.
 */
export async function writeMetadata(
  libDir: string,
  metadata: AuthMetadata,
): Promise<void> {
  const filePath = metadataPath(libDir);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, metadata, { spaces: 2 });
}

/**
 * Creates a fresh metadata object for a new installation.
 */
export function createMetadata(opts: {
  libDir: string;
  alias: string;
  srcDir: boolean;
  clean: boolean;
  hasAuthTs: boolean;
  hasMiddleware: boolean;
  middlewareType: "middleware" | "proxy";
}): AuthMetadata {
  const now = new Date().toISOString();
  return {
    version: __LIB_VERSION__,
    installedAt: now,
    updatedAt: now,
    config: {
      libDir: opts.libDir,
      alias: opts.alias,
      srcDir: opts.srcDir,
      clean: opts.clean,
    },
    files: {
      hasAuthTs: opts.hasAuthTs,
      hasMiddleware: opts.hasMiddleware,
      middlewareType: opts.middlewareType,
      hasOAuthRoute: false,
    },
    features: {
      oauth: {
        enabled: false,
        providers: [],
      },
    },
  };
}

/**
 * Merges a partial update into existing metadata and bumps updatedAt.
 */
export function mergeMetadata(
  existing: AuthMetadata,
  patch: Partial<AuthMetadata>,
): AuthMetadata {
  return {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
    version: __LIB_VERSION__,
    config: { ...existing.config, ...(patch.config ?? {}) },
    files: { ...existing.files, ...(patch.files ?? {}) },
    features: {
      oauth: {
        ...existing.features.oauth,
        ...(patch.features?.oauth ?? {}),
      },
    },
  };
}
