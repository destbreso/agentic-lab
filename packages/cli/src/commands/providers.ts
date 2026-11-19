// ============================================
// jig providers, jig brains, jig doctor: the same as /providers and /brains, for scripts
// ============================================

import chalk from "chalk";
import { ENTRY_KINDS, PRESETS, discoverLocal, discoverySummary, loadConfig, needsKey, userConfigFile } from "jig-core";
import { loadModels, readHidden, removeEntry, resolveNow, saveBrain, saveEntry, storeInKeychain, testOne, type LoadedModels } from "../providers.js";

const fail = (message: string) => {
  process.stderr.write(chalk.red(`  ✗ ${message}\n`));
  process.exitCode = 2;
};

async function models(): Promise<LoadedModels> {
  return loadModels(await loadConfig(process.cwd()));
}

/** One line per entry: its kind, where it is, its default model, and where its key comes from (never the key). */
export function entryLines(m: LoadedModels): string[] {
  return m.states.map((s) => {
    const key = s.key ? `key from ${s.source}` : !needsKey(s.entry) && s.source === "none" ? "no key needed" : s.source === "none" ? "no key" : `no key in ${s.source}`;
    return `  ${s.entry.name.padEnd(14)} ${s.entry.kind.padEnd(18)} ${(s.entry.baseUrl ?? "(its default)").padEnd(42)} ${(s.entry.defaultModel ?? "").padEnd(20)} ${key}`;
  });
}

/** Ask this machine's model servers and print what answered, each with its models; with save, keep the new ones. */
async function discoverLines(m: LoadedModels, save = false): Promise<string[]> {
  const found = await discoverLocal();
  m.applyDiscovery(found);
  const out = [`  this machine (127.0.0.1 only): ${discoverySummary(found)}`];
  for (const d of found) {
    const st = m.states.find((s) => s.discovered && s.entry.baseUrl === d.baseUrl);
    const as = st ? `found, not kept${save ? "" : ` (jig providers discover --save keeps it as ${st.entry.name})`}` : "configured already";
    out.push(`  ${d.name.padEnd(14)} ${d.label.padEnd(30)} ${d.baseUrl.padEnd(32)} ${String(d.models.length).padStart(3)} models ∙ ${as}`);
    if (save && st) {
      saveEntry({ name: st.entry.name, kind: st.entry.kind, ...(st.entry.baseUrl ? { baseUrl: st.entry.baseUrl } : {}), ...(st.entry.defaultModel ? { defaultModel: st.entry.defaultModel } : {}) });
      out.push(`    kept as ${st.entry.name} in ${userConfigFile()}`);
    }
  }
  const keys = m.states.filter((s) => s.key && s.source.startsWith("env:")).map((s) => `${s.entry.name} (key found in ${s.source})`);
  if (keys.length) out.push(`  keys in the environment: ${keys.join(", ")}`);
  return out;
}

export async function providersCommand(action: string | undefined, args: string[], options: { kind?: string; preset?: string; baseUrl?: string; key?: string; keychain?: boolean; defaultModel?: string; model?: string; save?: boolean }): Promise<void> {
  try {
    switch (action ?? "list") {
      case "list": {
        const m = await models();
        console.log(chalk.gray(`  ${"entry".padEnd(14)} ${"kind".padEnd(18)} ${"where".padEnd(42)} ${"default model".padEnd(20)} key`));
        for (const l of entryLines(m)) console.log(l);
        for (const w of m.warnings) console.log(chalk.yellow(`  ! ${w}`));
        console.log(chalk.gray(`\n  your config: ${userConfigFile()} ∙ presets: ${Object.keys(PRESETS).join(", ")}`));
        return;
      }
      case "discover": {
        for (const l of await discoverLines(await models(), Boolean(options.save))) console.log(l);
        return;
      }
      case "add": {
        const [name] = args;
        if (!name) return fail("jig providers add <name> [--kind k | --preset p] [--base-url u] [--key env:NAME | --key command:<program> | --keychain] [--default-model m]");
        const kind = options.kind ?? (options.preset ? "openai-compatible" : (ENTRY_KINDS as readonly string[]).includes(name) ? name : undefined);
        if (!kind || !(ENTRY_KINDS as readonly string[]).includes(kind)) return fail(`--kind is one of ${ENTRY_KINDS.join(", ")}, or give --preset (${Object.keys(PRESETS).join(", ")})`);
        if (options.preset && !PRESETS[options.preset]) return fail(`no preset ${options.preset}: ${Object.keys(PRESETS).join(", ")}`);
        let key = options.key;
        if (options.keychain || (!key && process.stdin.isTTY && ["anthropic", "openai", "gemini", "openrouter"].includes(kind) && !options.preset)) {
          // Typed in without echo, kept in the OS keychain, never in a file.
          const typed = await readHidden(`  ${name}'s key (hidden, kept in the keychain): `);
          if (!typed) return fail("no key typed");
          storeInKeychain(name, typed);
          key = "keychain";
        }
        saveEntry({ name, kind, ...(options.preset ? { preset: options.preset } : {}), ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}), ...(key ? { key } : {}), ...(options.defaultModel ? { defaultModel: options.defaultModel } : {}) });
        console.log(`  ${name} saved in ${userConfigFile()}${key ? `, its key from ${key.startsWith("command:") ? "a command" : key}` : ""}`);
        return;
      }
      case "test": {
        const m = await models();
        const names = args.length ? args : m.states.map((s) => s.entry.name);
        for (const name of names) {
          const r = await testOne(m, name, options.model);
          console.log(`  ${r.ok ? chalk.green("✓") : chalk.red("✗")} ${name.padEnd(14)} ${r.ok ? `${r.ms} ms ∙ ` : ""}${r.detail}`);
          if (!r.ok) process.exitCode = 1;
        }
        return;
      }
      case "remove": {
        const [name] = args;
        if (!name) return fail("jig providers remove <name>");
        if (!removeEntry(name)) return fail(`no entry ${name} in ${userConfigFile()}`);
        console.log(`  ${name} removed, and its key from the keychain if it was there`);
        return;
      }
      default:
        fail(`jig providers ${action}: list, discover, add, test or remove`);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

export async function brainsCommand(action: string | undefined, args: string[]): Promise<void> {
  try {
    const m = await models();
    switch (action ?? "list") {
      case "list":
        for (const [name, chain] of Object.entries(m.brainsNow)) console.log(`  ${name.padEnd(12)} ${chain.join("  ⇢  ")}`);
        return;
      case "set": {
        const [name, ...chain] = args;
        if (!name || !chain.length) return fail("jig brains set <name> <entry/model> [<entry/model>...]");
        saveBrain(name, chain);
        console.log(`  ${name}: ${chain.join("  ⇢  ")} (in ${userConfigFile()})`);
        return;
      }
      case "test": {
        for (const name of args.length ? args : Object.keys(m.brainsNow)) {
          const r = await resolveNow(m, name);
          console.log(`  ${r.answers ? chalk.green("✓") : chalk.red("✗")} ${name.padEnd(12)} ${r.answers ? `${r.answers} would answer now` : "nothing in its chain answers now"}`);
          for (const n of r.notes) console.log(chalk.gray(`      ${n}`));
          if (!r.answers) process.exitCode = 1;
        }
        return;
      }
      default:
        fail(`jig brains ${action}: list, set or test`);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Providers, whether each has its key (never shown), and which model each brain would answer with now. */
export async function doctorCommand(): Promise<void> {
  const m = await models();
  console.log(chalk.bold("  this machine"));
  for (const l of await discoverLines(m)) console.log(l);
  console.log(chalk.bold("\n  providers"));
  for (const l of entryLines(m)) console.log(l);
  for (const w of m.warnings) console.log(chalk.yellow(`  ! ${w}`));
  console.log(chalk.bold("\n  brains"));
  for (const name of Object.keys(m.brainsNow)) {
    const r = await resolveNow(m, name);
    console.log(`  ${r.answers ? chalk.green("✓") : chalk.red("✗")} ${name.padEnd(12)} ${r.answers ?? "nothing answers now"}${r.notes.length ? chalk.gray(`  (${r.notes.join("; ")})`) : ""}`);
  }
  console.log(chalk.gray(`\n  default model: ${m.defaultRef} ∙ your config: ${userConfigFile()}`));
}
