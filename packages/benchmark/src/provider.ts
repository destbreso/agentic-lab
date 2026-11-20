// ============================================
// The spec's model, as a provider
// ============================================
// "<entry>/<model>": a provider entry of the person's Jig configuration, or a
// provider kind with its defaults (ollama, openai, anthropic...). The key is
// resolved from its reference, as jig does, and never printed. One model, no
// chain: no role can fall back to another, so the arms differ by topology alone.

import {
  ENTRY_KINDS,
  entriesOf,
  entryProvider,
  listEntryModels,
  loadConfig,
  needsKey,
  ollamaPort,
  resolveKey,
  userConfigFile,
  type LLMProvider,
  type ProviderEntry,
} from "jig-core";

export interface ModelProvider {
  provider: LLMProvider;
  entry: ProviderEntry;
  model: string;
  /** Null when the model answers its provider's list; otherwise what is wrong. */
  check(): Promise<string | null>;
}

const isLocal = (e: ProviderEntry) => e.kind === "ollama" || /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(e.baseUrl ?? "");

export async function providerFor(ref: string, configDir: string): Promise<ModelProvider> {
  const slash = ref.indexOf("/");
  const name = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  const config = await loadConfig(configDir);
  const entries = entriesOf({ ...(config.providers as unknown as Record<string, Record<string, unknown>>) });
  let entry = entries.find((e) => e.name === name);
  if (!entry && (ENTRY_KINDS as readonly string[]).includes(name)) {
    entry = { name, kind: name as ProviderEntry["kind"], ...(name === "ollama" && ollamaPort() ? { baseUrl: `http://127.0.0.1:${ollamaPort()}` } : {}) };
  }
  if (!entry) throw new Error(`no provider entry named ${name}: name one of your Jig configuration (${entries.map((e) => e.name).join(", ") || "none"}) or a kind (${ENTRY_KINDS.join(", ")})`);
  if (config.privacy === "local-only" && !isLocal(entry)) throw new Error(`${name} is a cloud provider, and this project is local-only ("providers": "local-only" in its jig.config.json)`);
  let key: string | undefined;
  if (needsKey(entry)) {
    const r = await resolveKey(entry, process.env, userConfigFile());
    if (!r.key) throw new Error(`${name} has no key (${r.source === "none" ? "none configured" : `nothing in ${r.source}`})`);
    key = r.key;
  }
  const found = entry;
  return {
    provider: entryProvider(entry, model, key),
    entry,
    model,
    async check() {
      let listed: string[];
      try {
        listed = await listEntryModels(found, key, fetch, 10_000);
      } catch (e) {
        return `${name} does not answer: ${(e as Error).message}`;
      }
      const has = listed.includes(model) || listed.some((m) => m === `${model}:latest`);
      return has ? null : `${name} does not list ${model} (it lists ${listed.slice(0, 8).join(", ") || "nothing"}${listed.length > 8 ? ", and more" : ""})${found.kind === "ollama" ? `: ollama pull ${model} gets it` : ""}`;
    },
  };
}
