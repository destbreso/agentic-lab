// ============================================
// Which model answers a role: a reference resolved to a provider
// ============================================
// A role names a model as "<entry>/<model>" (ollama/qwen2.5:7b). The session
// asks this module for the provider behind a reference, the default
// reference, and the models each configured entry has now. Today an entry is
// a provider the configuration names (ollama, openai, anthropic, google,
// openrouter, or any openai-compatible server, from the user's config: see
// ../providers.ts); the session never builds a provider itself.

import type { LLMProvider } from "jig-core";

export interface ModelList {
  entry: string;
  models: string[];
  error?: string;
}

export interface Models {
  /** The reference roles use when the session names none. */
  defaultRef: string;
  /** A provider for a reference; throws with a sentence when it names nothing configured. */
  provider(ref: string): LLMProvider;
  /** The configured entries' models, asked live. */
  list(): Promise<ModelList[]>;
  /** The entries a reference may start with. */
  entries(): string[];
  /** The models a brain stands for, in order; absent when this source has no brains. */
  chain?(brain: string): string[];
}

/** "ollama/qwen2.5:7b" as its entry and model; a bare model belongs to the default entry. */
export function splitRef(ref: string, defaultEntry: string): { entry: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0) return { entry: defaultEntry, model: ref };
  return { entry: ref.slice(0, slash), model: ref.slice(slash + 1) };
}
