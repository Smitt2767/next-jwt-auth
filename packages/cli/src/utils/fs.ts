import fs from "fs";
import path from "path";

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function dirExists(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveCwd(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}
