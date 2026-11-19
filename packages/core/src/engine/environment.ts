// ============================================
// The environment a role works in, said in its system prompt
// ============================================
// As Claude Code does, each role is told where it runs: the working
// directory, the platform, the date, whether it is a git repository, and that
// it runs inside Jig (a model left to guess once called Jig an OpenAPI tool).

import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ChatCompletionOptions, LLMProvider } from "../types/llm.js";

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };

/** The block, for a working directory, at a date. */
export function environmentBlock(workingDir: string, now = new Date(), platform: string = process.platform): string {
  let dir = path.resolve(workingDir);
  let git = false;
  for (let i = 0; i < 30; i++) {
    if (existsSync(path.join(dir, ".git"))) {
      git = true;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return [
    "## Environment",
    "- You run inside Jig, a harness that runs several models as the roles of a topology (a Joint Inference Graph); you are one of its roles.",
    `- Working directory: ${path.resolve(workingDir)}`,
    `- Platform: ${PLATFORMS[platform] ?? platform}`,
    `- Today's date: ${now.toISOString().slice(0, 10)}`,
    `- A git repository: ${git ? "yes" : "no"}`,
  ].join("\n");
}

/** A provider whose every call carries the block at the end of its system prompt (or as one, when it has none). */
export function withEnvironment(provider: LLMProvider, block: string): LLMProvider {
  const add = (o: ChatCompletionOptions): ChatCompletionOptions => {
    const i = o.messages.findIndex((m) => m.role === "system");
    if (i >= 0 && o.messages[i].content.includes(block)) return o;
    const messages = i >= 0 ? o.messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${block}` } : m)) : [{ role: "system" as const, content: block }, ...o.messages];
    return { ...o, messages };
  };
  const wrapped: LLMProvider = Object.create(provider);
  wrapped.chat = (o) => provider.chat(add(o));
  if (provider.chatStream) wrapped.chatStream = (o) => provider.chatStream!(add(o));
  return wrapped;
}
