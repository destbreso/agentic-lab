// ============================================
// Provider entries: named connections to model providers, keys by reference
// ============================================
// An entry is a name for one connection: its kind (ollama, anthropic, openai,
// gemini, openrouter, or any openai-compatible server), where it is, and how
// its key is found. A role names a model as "<entry>/<model>". Several entries
// of one kind are fine (two Ollama hosts). An entry's key is a reference,
// never the key: "env:NAME", "keychain" (the OS keychain, through the
// optional @napi-rs/keyring) or "command:<program and arguments>", a helper
// whose stdout is the key, run without a shell. A raw apiKey someone wrote by
// hand is still read, with a warning. Every key read is registered for
// redaction, and goes only to its own entry's provider.

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import type { LLMProvider } from "../types/llm.js";
import { createProvider } from "./factory.js";
import { registerSecret } from "./secrets.js";

export const ENTRY_KINDS = ["ollama", "anthropic", "openai", "gemini", "openrouter", "openai-compatible"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface ProviderEntry {
  name: string;
  kind: EntryKind;
  baseUrl?: string;
  /** How the key is found: env:NAME, keychain, or command:<program args>. */
  key?: string;
  /** A key written in clear by hand: read, with a warning. Jig never writes one. */
  apiKey?: string;
  defaultModel?: string;
  /** The preset it was made from, for an openai-compatible server. */
  preset?: string;
}

/** Common servers that speak OpenAI's API: where they are and where their key usually lives. */
export const PRESETS: Record<string, { baseUrl: string; keyEnv?: string; label: string }> = {
  lmstudio: { baseUrl: "http://localhost:1234/v1", label: "LM Studio" },
  llamacpp: { baseUrl: "http://localhost:8080/v1", label: "llama.cpp server" },
  vllm: { baseUrl: "http://localhost:8000/v1", label: "vLLM" },
  jan: { baseUrl: "http://localhost:1337/v1", label: "Jan" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", label: "Groq" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", label: "Mistral" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  together: { baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", label: "Together" },
};

/** Where each kind is when an entry names no base URL, and the variable its key usually lives in. */
export const KIND_DEFAULTS: Record<EntryKind, { baseUrl?: string; keyEnv?: string[] }> = {
  ollama: { baseUrl: "http://localhost:11434" },
  anthropic: { baseUrl: "https://api.anthropic.com", keyEnv: ["ANTHROPIC_API_KEY"] },
  openai: { baseUrl: "https://api.openai.com/v1", keyEnv: ["OPENAI_API_KEY"] },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyEnv: ["OPENROUTER_API_KEY"] },
  "openai-compatible": {},
};

const NEEDS_KEY: ReadonlySet<EntryKind> = new Set(["anthropic", "openai", "gemini", "openrouter"]);

/** The configuration's providers section, as entries. A section named after a kind (ollama, openai...) is that kind. */
export function entriesOf(providers: Record<string, Record<string, unknown>>): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  for (const [name, raw] of Object.entries(providers)) {
    const preset = typeof raw.preset === "string" ? raw.preset : PRESETS[name] ? name : undefined;
    const declared = typeof raw.kind === "string" ? raw.kind : name === "google" ? "gemini" : name;
    const kind = (ENTRY_KINDS as readonly string[]).includes(declared) ? (declared as EntryKind) : preset ? "openai-compatible" : null;
    if (!kind) continue;
    out.push({
      name,
      kind,
      ...(typeof raw.baseUrl === "string" ? { baseUrl: raw.baseUrl } : preset && PRESETS[preset] ? { baseUrl: PRESETS[preset].baseUrl } : {}),
      ...(typeof raw.key === "string" ? { key: raw.key } : preset && PRESETS[preset]?.keyEnv ? { key: `env:${PRESETS[preset].keyEnv}` } : {}),
      ...(typeof raw.apiKey === "string" && raw.apiKey ? { apiKey: raw.apiKey } : {}),
      ...(typeof raw.defaultModel === "string" ? { defaultModel: raw.defaultModel } : {}),
      ...(preset ? { preset } : {}),
    });
  }
  return out;
}

export interface ResolvedKey {
  key?: string;
  /** Where it came from, never the key itself. */
  source: string;
  /** Said once to the person: a raw key in a file, a missing helper. */
  warnings: string[];
}

/** A command line split into its program and arguments, quotes respected; no shell ever reads it. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let any = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

function runHelper(argv: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: 64 * 1024, shell: false }, (error, stdout) => {
      if (error) reject(new Error(`the key helper ${argv[0]} failed (${(error as NodeJS.ErrnoException).code ?? "exit"}); its output is not shown`));
      else resolve(String(stdout).trim());
    });
  });
}

export type KeyringModule = { Entry: new (service: string, account: string) => { getPassword(): string | null; setPassword(p: string): void; deletePassword(): boolean } };

/** The OS keychain, when @napi-rs/keyring is installed; null when it is not. */
export function keychain(): KeyringModule | null {
  try {
    return createRequire(import.meta.url)("@napi-rs/keyring") as KeyringModule;
  } catch {
    return null;
  }
}

/** The service name Jig's keys are kept under in the OS keychain; the account is the entry's name. */
export const KEYCHAIN_SERVICE = "jig";

/** Find an entry's key. `configFile` is checked for being readable by others when it holds a raw key. */
export async function resolveKey(
  entry: ProviderEntry,
  env: NodeJS.ProcessEnv = process.env,
  configFile?: string,
  deps: { keychain?: () => KeyringModule | null } = {},
): Promise<ResolvedKey> {
  const warnings: string[] = [];
  const ref = entry.key;
  let key: string | undefined;
  let source = "none";
  if (ref?.startsWith("env:")) {
    const name = ref.slice(4);
    key = env[name] || undefined;
    source = `env:${name}`;
  } else if (ref === "keychain") {
    const kr = (deps.keychain ?? keychain)();
    source = "keychain";
    if (!kr) warnings.push(`${entry.name}: its key is in the keychain, but the keychain library (@napi-rs/keyring) is not installed`);
    else {
      try {
        key = new kr.Entry(KEYCHAIN_SERVICE, entry.name).getPassword() ?? undefined;
      } catch {
        warnings.push(`${entry.name}: the keychain did not give its key`);
      }
    }
  } else if (ref?.startsWith("command:")) {
    const argv = splitCommand(ref.slice(8).trim());
    source = `command:${argv[0] ?? ""}`;
    if (argv.length) {
      try {
        key = (await runHelper(argv)) || undefined;
      } catch (e) {
        warnings.push(`${entry.name}: ${(e as Error).message}`);
      }
    }
  } else if (ref) {
    warnings.push(`${entry.name}: key "${ref.slice(0, 12)}…" is not a reference; write env:NAME, keychain or command:<program>`);
  }
  if (!key && entry.apiKey) {
    key = entry.apiKey;
    source = "written in the config file";
    warnings.push(`${entry.name}: its key is written in clear in the config file; jig providers add can keep it in the keychain instead`);
    if (configFile) {
      try {
        if ((statSync(configFile).mode & 0o077) !== 0) warnings.push(`${entry.name}: and ${configFile} can be read by other users of this machine (chmod 600 it)`);
      } catch {
        /* no file to check */
      }
    }
  }
  if (!key && !ref && !entry.apiKey) {
    for (const name of entry.preset ? [PRESETS[entry.preset]?.keyEnv].filter((x): x is string => Boolean(x)) : (KIND_DEFAULTS[entry.kind].keyEnv ?? [])) {
      if (env[name]) {
        key = env[name];
        source = `env:${name}`;
        break;
      }
    }
  }
  registerSecret(key);
  return { ...(key ? { key } : {}), source, warnings };
}

/** Whether a kind cannot be called without a key. */
export const needsKey = (entry: ProviderEntry): boolean => NEEDS_KEY.has(entry.kind);

const baseOf = (entry: ProviderEntry) => entry.baseUrl ?? KIND_DEFAULTS[entry.kind].baseUrl;

/** A provider for one model of an entry, with the entry's key and nobody else's; temperature and token limit when given. */
export function entryProvider(entry: ProviderEntry, model: string, key?: string, tuning: { temperature?: number; maxTokens?: number } = {}): LLMProvider {
  const base = baseOf(entry);
  const t = { ...(tuning.temperature !== undefined ? { temperature: tuning.temperature } : {}), ...(tuning.maxTokens !== undefined ? { maxTokens: tuning.maxTokens } : {}) };
  switch (entry.kind) {
    case "ollama":
      return createProvider("ollama", { model, ...(base ? { baseUrl: base } : {}), ...t });
    case "anthropic":
      return createProvider("anthropic", { model, apiKey: key, ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}), ...t });
    case "gemini":
      return createProvider("google", { model, apiKey: key, baseUrl: base, ...t });
    case "openrouter":
      return createProvider("openrouter", { model, apiKey: key, baseUrl: base, ...t });
    case "openai":
      return createProvider("openai", { model, apiKey: key, baseUrl: base, ...t });
    case "openai-compatible":
      // A local server often wants no key; the OpenAI client wants one anyway.
      return createProvider("openai", { model, apiKey: key ?? "no-key", baseUrl: base, name: entry.name, ...t });
  }
}

/** The models an entry has now, asked from the provider itself. */
export async function listEntryModels(entry: ProviderEntry, key?: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<string[]> {
  const base = (baseOf(entry) ?? "").replace(/\/$/, "");
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`${entry.name} answered ${res.status} for its model list`), { status: res.status });
    return (await res.json()) as Record<string, unknown>;
  };
  if (entry.kind === "ollama") {
    const body = await get(`${base}/api/tags`, {});
    return ((body.models as Array<{ name: string }>) ?? []).map((m) => m.name);
  }
  if (entry.kind === "anthropic") {
    const body = await get(`${base}/v1/models`, { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" });
    return ((body.data as Array<{ id: string }>) ?? []).map((m) => m.id);
  }
  const body = await get(`${base}/models`, key ? { authorization: `Bearer ${key}` } : {});
  return ((body.data as Array<{ id: string }>) ?? []).map((m) => m.id.replace(/^models\//, ""));
}

/** One real call to an entry's model, and how long it took. */
export async function testEntry(entry: ProviderEntry, model: string, key?: string): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  try {
    const r = await entryProvider(entry, model, key).chat({ messages: [{ role: "user", content: "Reply with the word ok." }], maxTokens: 8, timeoutMs: 60_000 });
    return { ok: true, ms: Date.now() - started, detail: `${model} answered "${r.message.content.trim().slice(0, 20)}"` };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, detail: (e as Error).message };
  }
}
