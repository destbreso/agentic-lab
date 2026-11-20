// A path as the screen shows it. The home folder is written ~, so a capture of
// the screen never shows the person's user name.

import { homedir } from "node:os";
import * as path from "node:path";

export function shown(p: string, home = homedir()): string {
  if (!home) return p;
  if (p === home) return "~";
  return p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}
