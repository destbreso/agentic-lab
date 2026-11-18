// ============================================
// Storage backends that need a server, loaded only when used
// ============================================
// pg and redis are optional peers of jig-core: an install that keeps its runs
// in memory or in .jig/ never pulls them in. Both are CommonJS, so they load
// synchronously where a constructor needs them.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function loadOptional<T>(name: string, what: string): T {
  try {
    return require(name) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      throw new Error(`${what} needs the ${name} package, which jig-core leaves optional: npm install ${name}`);
    }
    throw error;
  }
}
