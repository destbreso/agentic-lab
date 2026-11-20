// How a path is shown and kept: never with the home folder spelled out, so a report or a lock carries no user name.

import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";

/** The home folder as ~. */
export function shownPath(path: string, home = homedir()): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Relative to the folder it was run from when inside it, else as shown: what a lock keeps of the spec's place. */
export function keptPath(path: string, cwd = process.cwd()): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : shownPath(path);
}
