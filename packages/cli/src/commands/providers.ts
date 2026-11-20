// ============================================
// jig providers, jig brains, jig doctor: the same as /providers and /brains, for scripts
// ============================================
// jig doctor ends with what Jig keeps on disk in the folder it runs in.

import chalk from "chalk";
import { ENTRY_KINDS, PRESETS, answersRoles, discoverLocal, discoverySummary, diskReport, formatBytes, loadConfig, needsKey, userConfigFile } from "jig-core";
import { shown } from "../display-path.js";
import { loadModels, readHidden, removeEntry, resolveNow, saveBrain, saveEntry, storeInKeychain, testOne, type LoadedModels } from "../providers.js";

const fail = (message: string) => {
  process.stderr.write(chalk.red(`  ✗ ${message}\n`));
  process.exitCode = 2;
};

async function models(workingDir = process.cwd()): Promise<LoadedModels> {
  return loadModels(await loadConfig(workingDir));
}

/** What is really there: every entry's models, and the default and the shipped brains chosen from them, as a session does. */
async function prepared(m: LoadedModels): Promise<string[]> {
  return m.prepare({ listTimeoutMs: 4000 });
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
  // JIG_DISCOVERY=off asks no server on this machine, as in a session.
  const found = process.env.JIG_DISCOVERY === "off" ? [] : await discoverLocal();
  m.applyDiscovery(found);
  const out = [`  this machine (127.0.0.1 only): ${discoverySummary(found)}`];
  for (const d of found) {
    const st = m.states.find((s) => s.discovered && s.entry.baseUrl === d.baseUrl);
    const as = st ? `found, not kept${save ? "" : ` (jig providers discover --save keeps it as ${st.entry.name})`}` : "configured already";
    const chat = d.models.filter(answersRoles).length;
    const embeds = d.models.length - chat;
    out.push(`  ${d.name.padEnd(14)} ${d.label.padEnd(30)} ${d.baseUrl.padEnd(32)} ${String(chat).padStart(3)} models${embeds ? ` and ${embeds} that only embed${embeds === 1 ? "s" : ""}` : ""} ∙ ${as}`);
    if (save && st) {
      saveEntry({ name: st.entry.name, kind: st.entry.kind, ...(st.entry.baseUrl ? { baseUrl: st.entry.baseUrl } : {}), ...(st.entry.defaultModel ? { defaultModel: st.entry.defaultModel } : {}) });
      out.push(`    kept as ${st.entry.name} in ${shown(userConfigFile())}`);
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
        console.log(chalk.gray(`\n  your config: ${shown(userConfigFile())} ∙ presets: ${Object.keys(PRESETS).join(", ")}`));
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
        console.log(`  ${name} saved in ${shown(userConfigFile())}${key ? `, its key from ${key.startsWith("command:") ? "a command" : key}` : ""}`);
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
        if (!removeEntry(name)) return fail(`no entry ${name} in ${shown(userConfigFile())}`);
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
    if (action !== "set") await prepared(m);
    switch (action ?? "list") {
      case "list":
        for (const [name, chain] of Object.entries(m.brainsNow)) console.log(`  ${name.padEnd(12)} ${chain.join("  ⇢  ")}`);
        return;
      case "set": {
        const [name, ...chain] = args;
        if (!name || !chain.length) return fail("jig brains set <name> <entry/model> [<entry/model>...]");
        saveBrain(name, chain);
        console.log(`  ${name}: ${chain.join("  ⇢  ")} (in ${shown(userConfigFile())})`);
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
export async function doctorCommand(workingDir = process.cwd()): Promise<void> {
  const m = await models(workingDir);
  console.log(chalk.bold("  this machine"));
  for (const l of await discoverLines(m)) console.log(l);
  const notes = await prepared(m);
  for (const n of notes) console.log(chalk.gray(`  ${n}`));
  console.log(chalk.bold("\n  providers"));
  for (const l of entryLines(m)) console.log(l);
  for (const w of m.warnings) console.log(chalk.yellow(`  ! ${w}`));
  console.log(chalk.bold("\n  brains"));
  for (const name of Object.keys(m.brainsNow)) {
    const r = await resolveNow(m, name);
    console.log(`  ${r.answers ? chalk.green("✓") : chalk.red("✗")} ${name.padEnd(12)} ${r.answers ?? "nothing answers now"}${r.notes.length ? chalk.gray(`  (${r.notes.join("; ")})`) : ""}`);
  }
  console.log(chalk.gray(`\n  default model: ${m.defaultRef} ∙ your config: ${shown(userConfigFile())}`));
  for (const l of await diskLines(workingDir)) console.log(l);
}

/** What Jig keeps on disk here: .jig, its trash, and temp folders left by Jig processes that ended. */
export async function diskLines(workingDir: string, o: { tmpRoot?: string; now?: number; alive?: (pid: number) => boolean } = {}): Promise<string[]> {
  const d = await diskReport(workingDir, o);
  const orphaned = d.orphans.reduce((n, x) => n + x.bytes, 0);
  return [
    chalk.bold("\n  disk"),
    `  .jig here          ${formatBytes(d.jigBytes).padStart(9)}   runs, sessions, history and settings${d.trashBytes ? `, the trash included` : ""}`,
    `  .jig/trash         ${formatBytes(d.trashBytes).padStart(9)}   ${d.trashBytes ? `deleted for good after its days; jig clean --empty-trash now` : "empty"}`,
    `  orphaned temp      ${formatBytes(orphaned).padStart(9)}   ${d.orphans.length ? `${d.orphans.length} folder${d.orphans.length === 1 ? "" : "s"} left by Jig processes that ended; the next session or jig run deletes them, or jig clean --yes` : "none"}`,
    ...d.orphans.map((x) => chalk.gray(`    ${shown(x.path)} ∙ ${formatBytes(x.bytes)} ∙ process ${x.pid}`)),
    chalk.gray("  jig clean shows what Jig would clean up, and changes nothing"),
  ];
}
