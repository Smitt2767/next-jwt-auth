import path from "path";
import fs from "fs-extra";

/**
 * Strips all JSDoc block comments (`/** ... *\/`) from a TypeScript source string.
 * Inline `//` comments are preserved.
 * Consecutive blank lines left by removal are collapsed to a single blank line.
 */
export function stripJsDoc(source: string): string {
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

/** Recursively strips JSDoc from all .ts/.tsx files under a directory. */
export async function stripJsDocFromDir(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await stripJsDocFromDir(full);
      } else if (/\.(tsx?)$/.test(entry.name)) {
        const source = await fs.readFile(full, "utf-8");
        await fs.writeFile(full, stripJsDoc(source), "utf-8");
      }
    }),
  );
}
