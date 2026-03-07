import fs from "fs";
import path from "path";

/** Returns true if a file exists at the given path */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/** Returns true if a directory exists at the given path */
export function dirExists(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/** Reads and parses a JSON file, returns null on any error */
export function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Resolves a path relative to the current working directory */
export function resolveCwd(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}
