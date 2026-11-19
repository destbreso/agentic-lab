// ============================================
// Which model answers a role: a reference resolved to a provider
// ============================================
// A role names a model as "<entry>/<model>" (ollama/qwen2.5:7b). The session
// asks this module for the provider behind a reference, the default
// reference, and the models each configured entry has now. Today an entry is
// a provider the configuration names (ollama, openai, anthropic, google,
// openrouter); the session never builds a provider itself.

import { createProvider, type JigConfig, type LLMProvider } from "jig-core";

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
}

/** "ollama/qwen2.5:7b" as its entry and model; a bare model belongs to the default entry. */
export function splitRef(ref: string, defaultEntry: string): { entry: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0) return { entry: defaultEntry, model: ref };
  return { entry: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/** Models from the configuration as loadConfig reads it. */
export function configModels(config: JigConfig, overrides: { provider?: string; model?: string } = {}): Models {
  const entry = overrides.provider || (config.loop.provider as string) || "ollama";
  const model = overrides.model || config.providers[entry]?.defaultModel || config.loop.model || "qwen2.5:7b";
  const configured = () => [...new Set([entry, ...Object.keys(config.providers)])];
  return {
    defaultRef: `${entry}/${model}`,
    entries: configured,
    provider(ref) {
      const { entry: e, model: m } = splitRef(ref, entry);
      const p = config.providers[e] ?? {};
      if (!configured().includes(e)) throw new Error(`no provider named ${e} is configured (configured: ${configured().join(", ")})`);
      return createProvider(e, { apiKey: p.apiKey, baseUrl: p.baseUrl, model: m });
    },
    async list() {
      return Promise.all(
        configured().map(async (e) => {
          try {
            const p = config.providers[e] ?? {};
            const models = await createProvider(e, { apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.defaultModel ?? "" }).listModels();
            return { entry: e, models };
          } catch (error) {
            return { entry: e, models: [], error: (error as Error).message };
          }
        }),
      );
    },
  };
}
