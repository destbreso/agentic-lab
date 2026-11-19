// ============================================
// Providers and brains, as the session and the subcommands use them
// ============================================
// Reads the entries and brains of the configuration, resolves each entry's
// key once (from its reference; a key is never printed), and answers a
// reference ("<entry>/<model>") or a brain's name with a provider: a brain,
// or a role's own chain, falls back along its chain only when a provider is
// unavailable. Writing goes to the user's config file, mode 600, and never
// holds a key: a key typed in goes to the OS keychain.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  KEYCHAIN_SERVICE,
  KIND_DEFAULTS,
  UnavailableModel,
  chainOf,
  chainProvider,
  defaultBrains,
  entriesOf,
  entryProvider,
  isModelRef,
  keychain,
  listEntryModels,
  needsKey,
  resolveKey,
  testEntry,
  userConfigFile,
  type Brains,
  type Fallback,
  type JigConfig,
  type LLMProvider,
  type ProviderEntry,
} from "jig-core";
import type { ModelList, Models } from "./session/models.js";

export interface EntryState {
  entry: ProviderEntry;
  key?: string;
  /** Where the key came from, or "none"; never the key. */
  source: string;
  warnings: string[];
}

const isLocal = (e: ProviderEntry) => e.kind === "ollama" || /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(e.baseUrl ?? KIND_DEFAULTS[e.kind].baseUrl ?? "");

export interface LoadedModels extends Models {
  states: EntryState[];
  brainsNow: Brains;
  warnings: string[];
  /** Fallbacks taken, as they happen. */
  onFallback?: (f: Fallback, role?: string) => void;
}

/** The entries and brains of a configuration, every key resolved once. */
export async function loadModels(config: JigConfig, overrides: { provider?: string; model?: string } = {}): Promise<LoadedModels> {
  const raw = { ...(config.providers as unknown as Record<string, Record<string, unknown>>) };
  // With nothing configured, a local Ollama is assumed, as before.
  if (!Object.keys(raw).length) raw.ollama = {};
  const entries = entriesOf(raw);
  const states: EntryState[] = [];
  for (const entry of entries) {
    const r = await resolveKey(entry, process.env, userConfigFile());
    states.push({ entry, ...(r.key ? { key: r.key } : {}), source: r.source, warnings: r.warnings });
  }
  const first = overrides.provider || (config.loop.provider as string) || entries[0]?.name || "ollama";
  const state = states.find((s) => s.entry.name === first);
  const model = overrides.model || state?.entry.defaultModel || config.loop.model || "qwen2.5:7b";
  const defaultRef = `${first}/${model}`;
  const brainsNow: Brains = {
    ...defaultBrains(
      states.map((s) => ({ name: s.entry.name, kind: s.entry.kind, ...(s.entry.defaultModel ? { defaultModel: s.entry.defaultModel } : {}), local: isLocal(s.entry) })),
      defaultRef,
    ),
    ...(config.brains ?? {}),
  };
  const made = (ref: string): LLMProvider => {
    const slash = ref.indexOf("/");
    const name = ref.slice(0, slash);
    const s = states.find((x) => x.entry.name === name);
    if (!s) throw new UnavailableModel("no-entry", `no provider entry named ${name} (entries: ${states.map((x) => x.entry.name).join(", ")})`);
    if (needsKey(s.entry) && !s.key) throw new UnavailableModel("no-key", `${name} has no key (${s.source === "none" ? "none configured" : `nothing in ${s.source}`})`);
    return entryProvider(s.entry, ref.slice(slash + 1), s.key);
  };
  const models: LoadedModels = {
    states,
    brainsNow,
    warnings: states.flatMap((s) => s.warnings),
    defaultRef,
    entries: () => states.map((s) => s.entry.name),
    chain: (brain: string) => {
      try {
        return chainOf(brain, brainsNow);
      } catch {
        return [];
      }
    },
    provider(choice: string): LLMProvider {
      // A model is itself; a brain or a chain falls back along its models when one is unavailable.
      if (isModelRef(choice) && !choice.includes(",")) return made(choice);
      const chain = choice.includes(",") ? choice.split(",").map((c) => c.trim()) : chainOf(choice, brainsNow);
      return chainProvider(chain, made, { ...(isModelRef(choice) ? {} : { brain: choice }), onFallback: (f) => models.onFallback?.(f) });
    },
    async list(): Promise<ModelList[]> {
      return Promise.all(
        states.map(async (s) => {
          try {
            return { entry: s.entry.name, models: await listEntryModels(s.entry, s.key) };
          } catch (e) {
            return { entry: s.entry.name, models: [], error: (e as Error).message };
          }
        }),
      );
    },
  };
  return models;
}

/** Which model of a chain would answer now: the first whose provider lists it (or answers its list). */
export async function resolveNow(models: LoadedModels, choice: string): Promise<{ chain: string[]; answers?: string; notes: string[] }> {
  const chain = isModelRef(choice) ? [choice] : chainOf(choice, models.brainsNow);
  const notes: string[] = [];
  const lists = new Map<string, string[] | Error>();
  for (const ref of chain) {
    const name = ref.slice(0, ref.indexOf("/"));
    const model = ref.slice(ref.indexOf("/") + 1);
    const s = models.states.find((x) => x.entry.name === name);
    if (!s) {
      notes.push(`${ref}: no entry named ${name}`);
      continue;
    }
    if (needsKey(s.entry) && !s.key) {
      notes.push(`${ref}: no key`);
      continue;
    }
    if (!lists.has(name)) lists.set(name, await listEntryModels(s.entry, s.key).catch((e) => e as Error));
    const list = lists.get(name)!;
    if (list instanceof Error) notes.push(`${ref}: ${list.message}`);
    else if (!list.includes(model) && !list.some((m) => m.startsWith(`${model}:`) || model.startsWith(`${m}:`))) notes.push(`${ref}: ${name} does not list ${model}`);
    else return { chain, answers: ref, notes };
  }
  return { chain, notes };
}

/** One real call through an entry, timed. */
export async function testOne(models: LoadedModels, name: string, model?: string): Promise<{ ok: boolean; ms: number; detail: string }> {
  const s = models.states.find((x) => x.entry.name === name);
  if (!s) return { ok: false, ms: 0, detail: `no entry named ${name}` };
  if (needsKey(s.entry) && !s.key) return { ok: false, ms: 0, detail: `no key (${s.source})` };
  let m = model ?? s.entry.defaultModel;
  if (!m) m = (await listEntryModels(s.entry, s.key).catch(() => []))[0];
  if (!m) return { ok: false, ms: 0, detail: "no model to test: give one, or set the entry's defaultModel" };
  return testEntry(s.entry, m, s.key);
}

// ---- The user's config file ----

export function readUserConfig(file = userConfigFile()): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
}

export function writeUserConfig(data: Record<string, unknown>, file = userConfigFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export interface AddEntry {
  name: string;
  kind?: string;
  preset?: string;
  baseUrl?: string;
  /** env:NAME or command:<program>; "keychain" when the key was stored there. */
  key?: string;
  defaultModel?: string;
}

/** Add or replace an entry in the user's config. A key is never written: only its reference. */
export function saveEntry(add: AddEntry, file = userConfigFile()): void {
  if (add.key && !/^(env:\S+|command:.+|keychain)$/.test(add.key)) throw new Error("a key is given as env:NAME, command:<program> or keychain, never in clear");
  const data = readUserConfig(file);
  const providers = { ...((data.providers as Record<string, unknown>) ?? {}) };
  providers[add.name] = Object.fromEntries(Object.entries({ kind: add.kind, preset: add.preset, baseUrl: add.baseUrl, key: add.key, defaultModel: add.defaultModel }).filter(([, v]) => v !== undefined));
  writeUserConfig({ ...data, providers }, file);
}

export function removeEntry(name: string, file = userConfigFile()): boolean {
  const data = readUserConfig(file);
  const providers = { ...((data.providers as Record<string, unknown>) ?? {}) };
  if (!(name in providers)) return false;
  delete providers[name];
  writeUserConfig({ ...data, providers }, file);
  const kr = keychain();
  try {
    kr && new kr.Entry(KEYCHAIN_SERVICE, name).deletePassword();
  } catch {
    /* nothing kept there */
  }
  return true;
}

/** Keep a key in the OS keychain under the entry's name. */
export function storeInKeychain(name: string, key: string): void {
  const kr = keychain();
  if (!kr) throw new Error("the keychain library (@napi-rs/keyring) is not installed: give the key as env:NAME or command:<program> instead");
  new kr.Entry(KEYCHAIN_SERVICE, name).setPassword(key);
}

export function saveBrain(name: string, chain: string[], file = userConfigFile()): void {
  for (const ref of chain) if (!isModelRef(ref)) throw new Error(`${ref} is not <entry>/<model>`);
  const data = readUserConfig(file);
  writeUserConfig({ ...data, brains: { ...((data.brains as Record<string, unknown>) ?? {}), [name]: chain } }, file);
}

/** Read a line from the terminal without echoing it. */
export function readHidden(prompt: string, stdin: NodeJS.ReadStream = process.stdin, out: NodeJS.WriteStream = process.stderr): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) return reject(new Error("a key is typed in a terminal; for a script, give --key env:NAME or command:<program>"));
    out.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (b: Buffer) => {
      for (const ch of b.toString("utf-8")) {
        if (ch === "\r" || ch === "\n") {
          done();
          return resolve(value);
        }
        if (ch === "\x03") {
          done();
          return reject(new Error("cancelled"));
        }
        if (ch === "\x7f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      out.write("\n");
    };
    stdin.on("data", onData);
  });
}
