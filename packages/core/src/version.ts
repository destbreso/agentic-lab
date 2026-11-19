// The installed jig-core's version, read from its own package.json (one folder up from src/ and dist/ alike).
import { readFileSync } from "node:fs";

export function coreVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
