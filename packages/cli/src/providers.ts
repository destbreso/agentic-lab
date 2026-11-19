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
  createDefaultToolkit,
  chainProvider,
  brainsFromCatalog,
  buildCatalog,
  defaultBrains,
  discoverLocal,
  discoverySummary,
  ollamaPort,
  entriesOf,
  entryProvider,
  isModelRef,
  keychain,
  listEntryModels,
  needsKey,
  resolveKey,
  serverKey,
  testEntry,
  userConfigFile,
  type Brains,
  type CatalogSource,
  type DiscoverOptions,
  type Discovered,
  type Fallback,
  type ModelInfo,
  type JigConfig,
  type Topology,
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
  /** Found on this machine and not in the configuration: what it is and its live models. Kept only when the person says so. */
  discovered?: { label: string; models: string[] };
  /** The live models of a configured entry that discovery also found running. */
  live?: string[];
}

const isLocal = (e: ProviderEntry) => e.kind === "ollama" || /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(e.baseUrl ?? KIND_DEFAULTS[e.kind].baseUrl ?? "");

export interface LoadedModels extends Models {
  states: EntryState[];
  brainsNow: Brains;
  warnings: string[];
  /** What discovery found on this machine, once it has run. */
  discovery: { found: Discovered[]; summary: string; at: number } | null;
  /** Take what discovery found: a server a configured entry already names only gets its live models; the rest join as discovered entries, and the shipped brains' local chains. */
  applyDiscovery(found: Discovered[]): void;
  /** Fallbacks taken, as they happen. */
  onFallback?: (f: Fallback, role?: string) => void;
  /** Every model the entries list, with what it can do; null until prepare has run. */
  catalog: ModelInfo[] | null;
  /** The project allows local models only ("providers": "local-only" in its jig.config.json). */
  localOnly: boolean;
  /** The brains whose fallback may cross from a local model to a cloud one. */
  crossToCloud: string[];
  /** Whether an entry's models run on this machine. */
  isLocalRef(ref: string): boolean;
  /** What a model can do, from the catalog. */
  capabilities(ref: string): ModelInfo | undefined;
  /**
   * Discover this machine's servers (or take what was found), list every entry's models, read what each can do,
   * and choose the default and the shipped brains from what is really there. Notes say what was chosen and why.
   */
  prepare(o?: { discovery?: DiscoverOptions; found?: Discovered[]; fresh?: boolean; listTimeoutMs?: number }): Promise<string[]>;
}

/** The model a default names before Jig has seen what is there; never called, since a run waits for prepare. */
export const FINDING = "(finding a model)";

/** The entries and brains of a configuration, every key resolved once. */
export async function loadModels(config: JigConfig, overrides: { provider?: string; model?: string; temperature?: number; maxTokens?: number } = {}): Promise<LoadedModels> {
  const raw = { ...(config.providers as unknown as Record<string, Record<string, unknown>>) };
  // With nothing configured, a local Ollama is assumed (where OLLAMA_HOST says, when it points at this machine).
  if (!Object.keys(raw).length) raw.ollama = ollamaPort() ? { baseUrl: `http://127.0.0.1:${ollamaPort()}` } : {};
  const entries = entriesOf(raw);
  const states: EntryState[] = [];
  for (const entry of entries) {
    const r = await resolveKey(entry, process.env, userConfigFile());
    states.push({ entry, ...(r.key ? { key: r.key } : {}), source: r.source, warnings: r.warnings });
  }
  const first = overrides.provider || (config.loop.provider as string) || entries[0]?.name || "ollama";
  const state = states.find((s) => s.entry.name === first);
  // A model is named here only when the person named one; otherwise it is chosen from what the entries list.
  const named = overrides.model || state?.entry.defaultModel || config.loop.model;
  const defaultRef = `${first}/${named ?? FINDING}`;
  const brainsOf = (): Brains => ({
    // Configured entries first: a discovered one comes after them in every chain.
    ...defaultBrains(
      states.map((s) => ({ name: s.entry.name, kind: s.entry.kind, ...(s.entry.defaultModel ? { defaultModel: s.entry.defaultModel } : {}), local: isLocal(s.entry) })),
      defaultRef,
    ),
    ...(config.brains ?? {}),
  });
  const brainsNow: Brains = brainsOf();
  const made = (ref: string): LLMProvider => {
    const slash = ref.indexOf("/");
    const name = ref.slice(0, slash);
    const s = states.find((x) => x.entry.name === name);
    if (!s) throw new UnavailableModel("no-entry", `no provider entry named ${name} (entries: ${states.map((x) => x.entry.name).join(", ")})`);
    if (needsKey(s.entry) && !s.key) throw new UnavailableModel("no-key", `${name} has no key (${s.source === "none" ? "none configured" : `nothing in ${s.source}`})`);
    if (config.privacy === "local-only" && !isLocal(s.entry)) throw new UnavailableModel("no-entry", `${name} is a cloud provider, and this project is local-only ("providers": "local-only" in its jig.config.json)`);
    if (ref.endsWith(`/${FINDING}`)) throw new UnavailableModel("no-entry", "no model has been found yet: /providers discover asks again, and /models chooses one");
    return entryProvider(s.entry, ref.slice(slash + 1), s.key, { ...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}), ...(overrides.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}) });
  };
  const localOnly = config.privacy === "local-only";
  const isLocalRef = (ref: string) => {
    const s = states.find((x) => x.entry.name === ref.slice(0, ref.indexOf("/")));
    return s ? isLocal(s.entry) : false;
  };
  const models: LoadedModels = {
    states,
    brainsNow,
    discovery: null,
    catalog: null,
    localOnly,
    crossToCloud: config.crossToCloud ?? [],
    isLocalRef,
    capabilities: (ref: string) => models.catalog?.find((m) => m.ref === ref),
    async prepare(o = {}) {
      const notes: string[] = [];
      // JIG_DISCOVERY=off asks no server on this machine (a test, or a machine where it is not wanted).
      if (o.found) models.applyDiscovery(o.found);
      else if (process.env.JIG_DISCOVERY === "off") models.applyDiscovery([]);
      else if (o.fresh || !models.discovery) models.applyDiscovery(await discoverLocal(o.discovery));
      // Every entry's models: what discovery saw, or the entry's own list (a cloud entry needs its key).
      const sources = await Promise.all(
        states.map(async (s): Promise<CatalogSource | null> => {
          if (localOnly && !isLocal(s.entry)) return null;
          if (needsKey(s.entry) && !s.key) return null;
          const base = s.entry.baseUrl ?? KIND_DEFAULTS[s.entry.kind].baseUrl ?? "";
          const listed = s.discovered?.models ?? s.live ?? (await listEntryModels(s.entry, s.key, fetch, o.listTimeoutMs ?? 4000).catch(() => null));
          return listed?.length ? { name: s.entry.name, kind: s.entry.kind, baseUrl: base, local: isLocal(s.entry), models: listed } : null;
        }),
      );
      models.catalog = await buildCatalog(sources.filter((x): x is CatalogSource => x !== null));
      const preferred = named ? `${first}/${named}` : undefined;
      const chosen = brainsFromCatalog(models.catalog, { ...(preferred ? { preferred } : {}), order: states.map((s) => s.entry.name) });
      if (preferred && !models.catalog.some((m) => m.ref === preferred)) {
        if (overrides.model) notes.push(`${preferred} is not listed by ${first}: it is used as you asked, and may not answer`);
        else if (chosen.defaultRef) notes.push(`${preferred} is not listed by ${first}, so ${chosen.defaultRef} is the default (${first === "ollama" ? `ollama pull ${named} gets it` : "check the name"})`);
      }
      if (overrides.model) models.defaultRef = preferred!;
      else if (chosen.defaultRef) models.defaultRef = chosen.defaultRef;
      // The shipped brains from what is there; the person's own brains still win.
      for (const k of Object.keys(brainsNow)) delete brainsNow[k];
      Object.assign(brainsNow, chosen.brains, config.brains ?? {});
      if (localOnly) for (const [k, chain] of Object.entries(brainsNow)) brainsNow[k] = chain.filter(isLocalRef);
      // What answers now, configured or found: "ollama up (3 models) ∙ lmstudio up (1)".
      const byEntry = new Map<string, number>();
      for (const m of models.catalog) byEntry.set(m.entry, (byEntry.get(m.entry) ?? 0) + 1);
      const summary = byEntry.size ? [...byEntry].map(([e, n], i) => `${e} up (${n}${i === 0 ? ` model${n === 1 ? "" : "s"}` : ""})`).join(" ∙ ") : "no model found";
      models.discovery = { found: models.discovery?.found ?? [], summary, at: Date.now() };
      return notes;
    },
    applyDiscovery(found: Discovered[]) {
      for (const s of states.filter((x) => x.discovered).map((x) => states.indexOf(x)).reverse()) states.splice(s, 1);
      for (const x of states) delete x.live;
      for (const d of found) {
        // A configured entry at the same server wins: no duplicate, only its live models.
        const same = states.find((s) => serverKey(s.entry.baseUrl ?? KIND_DEFAULTS[s.entry.kind].baseUrl ?? "") === serverKey(d.baseUrl));
        if (same) {
          same.live = d.models;
          continue;
        }
        const name = states.some((s) => s.entry.name === d.name) ? `${d.name}-local` : d.name;
        states.push({ entry: { name, kind: d.kind, baseUrl: d.baseUrl, ...(d.models[0] ? { defaultModel: d.models[0] } : {}) }, source: "none", warnings: [], discovered: { label: d.label, models: d.models } });
      }
      // The brains are made again from every entry; the person's own brains still win.
      for (const k of Object.keys(brainsNow)) delete brainsNow[k];
      Object.assign(brainsNow, brainsOf());
      models.discovery = { found, summary: discoverySummary(found), at: Date.now() };
    },
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
      return chainProvider(chain, made, {
        ...(isModelRef(choice) ? {} : { brain: choice }),
        onFallback: (f) => models.onFallback?.(f),
        // The privacy boundary: a local model's work falls to the cloud only when its brain says so, and never in a local-only project.
        isLocal: isLocalRef,
        crossToCloud: !localOnly && !isModelRef(choice) && (config.crossToCloud ?? []).includes(choice),
      });
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

/**
 * A role with tools on a model that cannot use them answers without acting, and says nothing of it: each such
 * role, named before the run. Only the work tools count (every role may ask jig_help).
 */
export function toolWarnings(topology: Topology, m: Partial<LoadedModels>, defaultRef: string): string[] {
  if (!m.capabilities) return [];
  const all = createDefaultToolkit().getAll().map((t) => t.definition.name);
  const out: string[] = [];
  for (const n of topology.nodes) {
    const tools = (n.config.toolPolicy?.allow ?? n.config.enabledTools ?? all).filter((t) => t !== "jig_help" && !(n.config.toolPolicy?.deny ?? []).includes(t));
    if (!tools.length) continue;
    const b = n.config.brain;
    const entry = defaultRef.slice(0, defaultRef.indexOf("/"));
    const ref = b?.chain?.length ? b.chain[0] : b?.brain ? (m.chain?.(b.brain)[0] ?? "") : b?.model ? `${b.provider ?? entry}/${b.model}` : defaultRef;
    const info = m.capabilities(ref);
    if (info?.tools === false) out.push(`${topology.faces?.[n.id]?.label ?? n.id} has tools (${tools.join(", ")}), but ${ref} cannot use them: it will answer without acting. /models gives it one that can${info.source === "table" ? " (Jig's own table says so; the provider did not)" : ""}.`);
  }
  return out;
}
