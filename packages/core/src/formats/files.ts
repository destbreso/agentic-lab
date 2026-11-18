// ============================================
// Where the core package's own files are
// ============================================
// The vendored schemas and the built-in topologies sit beside src/ and dist/
// in the package. They are found from this module's location, the same depth
// in src/ and dist/; a bundler that hides that location can point at the
// package with AGENTIC_LAB_CORE_DIR.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@agentic-lab/core";
let cached: string | null = null;

function isCorePackage(dir: string): boolean {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return false;
  try {
    return JSON.parse(readFileSync(manifest, "utf-8")).name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

function walkUp(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (isCorePackage(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The directory of the @agentic-lab/core package. */
export function corePackageDir(): string {
  if (cached) return cached;
  const candidates: Array<() => string | null> = [
    () => (process.env.AGENTIC_LAB_CORE_DIR ? resolve(process.env.AGENTIC_LAB_CORE_DIR) : null),
    () => {
      try {
        return walkUp(dirname(fileURLToPath(import.meta.url)));
      } catch {
        return null;
      }
    },
    () => {
      try {
        return dirname(createRequire(import.meta.url).resolve(`${PACKAGE_NAME}/package.json`));
      } catch {
        return null;
      }
    },
    () => walkUp(join(process.cwd(), "node_modules", "@agentic-lab", "core")),
    () => walkUp(join(process.cwd(), "packages", "core")),
    () => walkUp(join(process.cwd(), "..", "core")),
  ];
  for (const candidate of candidates) {
    const dir = candidate();
    if (dir && isCorePackage(dir)) return (cached = dir);
  }
  throw new Error(`Cannot find the ${PACKAGE_NAME} package directory; set AGENTIC_LAB_CORE_DIR`);
}

export const coreFile = (...parts: string[]): string => join(corePackageDir(), ...parts);

export const readCoreJson = <T = unknown>(...parts: string[]): T => JSON.parse(readFileSync(coreFile(...parts), "utf-8")) as T;
