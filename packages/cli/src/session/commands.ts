// ============================================
// The session's slash commands
// ============================================
// Each command names itself, says what it does, completes its arguments, and
// writes what it has to say into the conversation. Settings a command
// changes take effect on the next task and are kept with the session.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import {
  DEFAULT_SHELL_COMMANDS,
  CONSULT_SIGHTS,
  createDefaultToolkit,
  draw,
  drawingOf,
  initialRunState,
  layoutFor,
  listRecipes,
  measureSight,
  shortTokens,
  toText,
  type ConsultSight,
  type MemoryScope,
  type Meaning,
  type PermissionMode,
  type Topology,
  len,
  padCells,
  parseRule,
} from "jig-core";
import type { Line, PickItem, SessionController } from "./controller.js";
import { ENTRY_KINDS, PRESETS, needsKey } from "jig-core";
import { removeEntry, resolveNow, saveBrain, saveEntry, storeInKeychain, testOne, type LoadedModels } from "../providers.js";
import { MODE_LABEL, ruleSources, saveLocalRules } from "../permissions.js";

export interface SlashCommand {
  name: string;
  /** What it takes, as /help writes it. */
  usage: string;
  summary: string;
  /** Completions for the word being typed, given the words before it. */
  complete?: (args: string[], ctrl: SessionController) => string[] | Promise<string[]>;
  run: (args: string[], ctrl: SessionController, rest: string) => Promise<void> | void;
}

const line = (...parts: Array<[string, Meaning]>): Line => parts;
const plain = (text: string, k: Meaning = "ink"): Line => [[text, k]];
const MEMORY_SCOPES: MemoryScope[] = ["off", "session", "task", "shared", "run"];

/** Topology files in the working directory, for completion. */
function topologyFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => /\.(ya?ml|json)$/i.test(f));
  } catch {
    return [];
  }
}

function roleIds(ctrl: SessionController): string[] {
  const t = ctrl.topology;
  return t ? [...t.nodes.map((n) => n.id), ...t.consults.map((c) => c.role.id)] : [];
}

function roleTable(ctrl: SessionController): Line[] {
  const t = ctrl.topology;
  if (!t) return [plain("no topology", "fail")];
  // The cells of each row first, so every column is padded to its widest, in display cells.
  const cells: Array<{ name: string; id: string; model: string; modelK: Meaning; note: string }> = [];
  for (const n of t.nodes) {
    const face = t.faces[n.id];
    const own = ctrl.settings.roleModels[n.id];
    const brain = !own && !ctrl.settings.defaultModel ? n.config.brain?.brain : undefined;
    const first = brain ? ctrl.models.chain?.(brain)[0] : undefined;
    cells.push({ name: `${face?.icon ?? "◦"} ${face?.label ?? n.id}`, id: n.id, model: brain ? brain : ctrl.modelOf(n.id), modelK: own || brain ? "ink" : "dim", note: own ? "" : brain ? `(its brain: ${first ?? "no model"} first)` : "(the default)" });
  }
  for (const c of t.consults) {
    const model = ctrl.settings.advisor.model ?? ctrl.settings.roleModels[c.role.id] ?? (c.role.brain?.model ? `${c.role.brain.provider ?? ""}/${c.role.brain.model}` : ctrl.modelOf(""));
    cells.push({ name: `${c.role.face.icon} ${c.role.face.label}`, id: c.role.id, model, modelK: "ink", note: `consulted by ${c.from}` });
  }
  const w = (k: "name" | "id" | "model") => Math.max(...cells.map((c) => len(c[k])));
  return cells.map((c) => line([`  ${padCells(c.name, w("name"))}  `, "b"], [`${padCells(c.id, w("id"))}  `, "faint"], [`${padCells(c.model, w("model"))}  `, c.modelK], [c.note, "faint"]));
}

/** Brains first, then every model each provider has now, as picker items, the one in effect marked. */
async function modelItems(ctrl: SessionController, current?: string): Promise<PickItem[]> {
  const brains = (ctrl.models as Partial<LoadedModels>).brainsNow ?? {};
  const lists = await ctrl.models.list().catch(() => []);
  return [
    ...Object.entries(brains).map(([b, chain]) => ({ value: b, label: b, detail: `brain: ${chain.join(" ⇢ ") || "no model in it"}`, current: b === current })),
    ...lists.flatMap((l) =>
      l.models.map((m) => {
        // What the catalog knows of it: where it runs, whether it uses tools, its context window.
        const info = (ctrl.models as Partial<LoadedModels>).capabilities?.(`${l.entry}/${m}`);
        const detail = info ? `${info.local ? "local" : "cloud"} ∙ tools ${info.tools === true ? "✓" : info.tools === false ? "✗" : "?"}${info.context ? ` ∙ ${Math.round(info.context / 1000)}k context` : ""}${info.source === "table" ? " (Jig's table)" : ""}` : undefined;
        return { value: `${l.entry}/${m}`, label: `${l.entry}/${m}`, ...(detail ? { detail } : {}), current: `${l.entry}/${m}` === current };
      }),
    ),
  ];
}

/** A role's model as the session runs it, for a picker's detail. */
function roleModelDetail(ctrl: SessionController, id: string, brain?: string): string {
  const own = ctrl.settings.roleModels[id];
  if (own) return own;
  if (brain && !ctrl.settings.defaultModel) return `brain ${brain}`;
  return `${ctrl.modelOf(id)} (the default)`;
}

/** The roles of the topology, its advisor and "every other role", as picker items. */
function roleItems(ctrl: SessionController, withDefault: boolean): PickItem[] {
  const t = ctrl.topology;
  return [
    ...(t?.nodes ?? []).map((n) => ({ value: n.id, label: t!.faces[n.id]?.label ?? n.id, detail: roleModelDetail(ctrl, n.id, n.config.brain?.brain) })),
    ...(t?.consults ?? []).map((c) => ({ value: c.role.id, label: c.role.face.label, detail: `${ctrl.settings.advisor.model ?? roleModelDetail(ctrl, c.role.id, c.role.brain?.brain)} ∙ consulted by ${c.from}` })),
    ...(withDefault ? [{ value: "default", label: "every other role", detail: ctrl.modelOf("") }] : []),
  ];
}

/** A past run, newest first, with its outcome, time and task. */
async function pickRun(ctrl: SessionController, title: string): Promise<string | null> {
  const runs = await ctrl.pastRuns(50);
  if (!runs.length) {
    ctrl.info([plain("  no recorded runs here yet", "dim")], "runs");
    return null;
  }
  const when = (at: number) => (at ? new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  return ctrl.pickOne(
    title,
    runs.map((r) => ({ value: r.runId, label: `${r.outcome === "passed" ? "✓" : r.outcome === "failed" ? "✗" : "▪"} ${when(r.at)}`, detail: `${r.outcome ?? "no outcome"} ∙ ${r.topology} ∙ ${(r.task ?? "").replace(/\s+/g, " ").slice(0, 60)}` })),
  );
}

const MEMORY_WORDS: Record<MemoryScope, string> = {
  session: "this session's runs: the conversation so far, and what its runs kept",
  task: "runs of the same task, in any session",
  shared: "everything kept, across tasks",
  run: "only what the run itself writes",
  off: "nothing: each task starts with no memory, and the conversation is still its input",
};

const SIGHT_SAYS: Record<string, string> = { prompt: "sees it, in its prompt", delivered: "is given it, outside its prompt", none: "does not see it", own: "writes it" };

export const COMMANDS: SlashCommand[] = [
  {
    name: "help",
    usage: "/help",
    summary: "what each command does, and the keys",
    run: (_args, ctrl) => {
      // A usage wider than the column takes a row of its own, and its summary starts in the column below it.
      const usageW = Math.min(36, Math.max(...COMMANDS.map((c) => len(c.usage))));
      const rows: Line[] = COMMANDS.flatMap((c) =>
        len(c.usage) > usageW ? [line([`  ${c.usage}`, "b"]), line([`  ${padCells("", usageW)}  `, ""], [c.summary, "dim"])] : [line([`  ${padCells(c.usage, usageW)}  `, "b"], [c.summary, "dim"])],
      );
      rows.push(plain(""));
      rows.push(plain("  Enter sends ∙ Alt+Enter, Ctrl+J or \\ then Enter start a new line ∙ ⇡⇣ history ∙ Tab completes", "dim"));
      rows.push(plain("  Typing while a run goes steers it (a note Do reads on its next turn) ∙ Esc stops the run", "dim"));
      rows.push(plain("  Ctrl+T folds the topology to one line ∙ PgUp PgDn scroll the conversation ∙ Ctrl+D quits", "dim"));
      rows.push(plain("  Shift+Tab cycles the permission mode: manual, accept edits, plan", "dim"));
      ctrl.info(rows, "help");
    },
  },
  {
    name: "topology",
    usage: "/topology [list|show|<id or file>]",
    summary: "the topology each task runs through: pick one, list them, draw it, or switch",
    complete: (args, ctrl) => (args.length <= 1 ? ["list", "show", ...listRecipes().map((r) => r.id), ...topologyFiles(ctrl.workingDir)] : []),
    run: async (args, ctrl) => {
      let [what] = args;
      if (!what) {
        const items: PickItem[] = [
          ...listRecipes().map((r) => {
            const consults = (r as Partial<Topology>).consults ?? [];
            return { value: r.id, label: r.id, detail: `${r.nodes.length} role${r.nodes.length > 1 ? "s" : ""}${consults.length ? " + advisor" : ""} ∙ ${r.name}`, current: r.id === ctrl.settings.topology };
          }),
          ...topologyFiles(ctrl.workingDir).map((f) => ({ value: f, label: f, detail: "a definition file here", current: f === ctrl.settings.topology })),
        ];
        const chosen = await ctrl.pickOne("The topology the next task runs through", items);
        if (!chosen) return;
        what = chosen;
      }
      if (what === "list") {
        const all = listRecipes();
        const idW = Math.max(...all.map((r) => len(r.id))) + 2;
        const roles = (r: (typeof all)[number]) => `${r.nodes.length} role${r.nodes.length > 1 ? "s" : ""}`;
        const rolesW = Math.max(...all.map((r) => len(roles(r)))) + 2;
        const rows = all.map((r) => line([r.id === ctrl.topology?.id ? "  ◉ " : "    ", r.id === ctrl.topology?.id ? "run" : "faint"], [padCells(r.id, idW), "b"], [padCells(roles(r), rolesW), "dim"], [r.name, "ink"]));
        rows.push(plain("  /topology picks one; /topology <id> switches; a .yaml or .json file works too", "faint"));
        ctrl.info(rows, "topologies");
        return;
      }
      if (what === "show") {
        if (!ctrl.topology) return;
        const d = ctrl.drawingFor(ctrl.topology);
        const width = Math.max(60, process.stdout.columns || 120);
        const g = draw(d, initialRunState(0), layoutFor(d, width, { sight: false }), { sight: false, width });
        ctrl.info([...toText(g).split("\n").map((l) => plain(l, "ink")), ...ctrl.topology.nodes.map((n) => plain(`  ${ctrl.topology!.faces[n.id]?.icon ?? ""} ${ctrl.topology!.faces[n.id]?.sentence ?? ""}`, "dim"))], ctrl.topology.name);
        return;
      }
      if (await ctrl.useTopology(what)) ctrl.info([line(["  the next task runs through ", "dim"], [ctrl.topology!.name, "b"], [` (${ctrl.topologySource})`, "faint"])], "topology");
    },
  },
  {
    name: "models",
    usage: "/models [list|table|<role> <entry/model or brain>|default ...]",
    summary: "a model or a brain per role, from any configured provider",
    complete: async (args, ctrl) => {
      if (args.length <= 1) return ["list", "table", "default", ...roleIds(ctrl)];
      const lists = await ctrl.models.list().catch(() => []);
      return [...Object.keys((ctrl.models as Partial<LoadedModels>).brainsNow ?? {}), ...lists.flatMap((l) => l.models.map((m) => `${l.entry}/${m}`))];
    },
    run: async (args, ctrl) => {
      let [what, ref] = args;
      if (!what) {
        const roles = roleItems(ctrl, true);
        const role = await ctrl.pickOne("Whose model", roles);
        if (!role) return;
        const current = role === "default" ? ctrl.modelOf("") : (ctrl.settings.roleModels[role] ?? ctrl.modelOf(role));
        const items = await modelItems(ctrl, current);
        if (!items.length) return ctrl.say("error", "no model to choose from: /providers says why");
        const chosen = await ctrl.pickOne(`The model or brain for ${roles.find((r) => r.value === role)?.label ?? role}`, items);
        if (!chosen) return;
        [what, ref] = [role, chosen];
      }
      if (what === "table") {
        ctrl.info([...roleTable(ctrl), plain("  /models picks; /models list shows what each provider has; /models <role> <entry/model> sets one", "faint")], "models");
        return;
      }
      if (what === "list") {
        const lists = await ctrl.models.list();
        const rows: Line[] = [];
        for (const l of lists) {
          rows.push(line([`  ${l.entry}`, "b"], [l.error ? `  ${l.error}` : `  ${l.models.length} model${l.models.length === 1 ? "" : "s"}`, l.error ? "fail" : "dim"]));
          for (const m of l.models.slice(0, 30)) rows.push(plain(`    ${l.entry}/${m}`, "ink"));
        }
        ctrl.info(rows, "models, live");
        return;
      }
      if (!ref) {
        ctrl.say("error", `/models ${what} needs a model: <entry>/<model>, such as ${ctrl.models.defaultRef}`);
        return;
      }
      try {
        ctrl.models.provider(ref);
      } catch (e) {
        ctrl.say("error", (e as Error).message);
        return;
      }
      if (what === "default") await ctrl.update({ defaultModel: ref });
      else if (roleIds(ctrl).includes(what)) await ctrl.update({ roleModels: { ...ctrl.settings.roleModels, [what]: ref } });
      else {
        ctrl.say("error", `no role ${what} in ${ctrl.topology?.name ?? "this topology"}: ${roleIds(ctrl).join(", ")}`);
        return;
      }
      ctrl.info(roleTable(ctrl), "models");
    },
  },
  {
    name: "tools",
    usage: "/tools [list|on|off <tool>]",
    summary: "each role's tools: a checklist per role, or one tool on or off for every role, for the session",
    complete: (args) => (args.length <= 1 ? ["list", "on", "off"] : createDefaultToolkit().getAll().map((t) => t.definition.name)),
    run: async (args, ctrl) => {
      const [what, name] = args;
      const all = createDefaultToolkit().getAll().map((t) => t.definition.name);
      if (!what && ctrl.topology) {
        const t = ctrl.topology;
        const role = await ctrl.pickOne(
          "Whose tools",
          t.nodes.map((n) => ({ value: n.id, label: t.faces[n.id]?.label ?? n.id, detail: (n.config.toolPolicy?.allow ?? n.config.enabledTools ?? all).filter((x) => !ctrl.settings.toolsOff.includes(x) && !(ctrl.settings.roleToolsOff?.[n.id] ?? []).includes(x)).join(", ") || "no tools" })),
        );
        if (!role) return;
        const node = t.nodes.find((n) => n.id === role)!;
        const own = node.config.toolPolicy?.allow ?? node.config.enabledTools ?? all;
        const offHere = ctrl.settings.roleToolsOff?.[role] ?? [];
        const on = await ctrl.pick(
          `${t.faces[role]?.label ?? role}'s tools for this session`,
          own.map((x) => ({ value: x, label: x, ...(ctrl.settings.toolsOff.includes(x) ? { detail: "off for every role" } : {}) })),
          { multi: true, checked: own.filter((x) => !ctrl.settings.toolsOff.includes(x) && !offHere.includes(x)) },
        );
        if (!on) return;
        // A tool checked here that was off for every role comes back for this role only.
        const roleToolsOff = { ...(ctrl.settings.roleToolsOff ?? {}) };
        const revived = ctrl.settings.toolsOff.filter((x) => on.includes(x));
        if (revived.length) for (const n of t.nodes) if (n.id !== role) roleToolsOff[n.id] = [...new Set([...(roleToolsOff[n.id] ?? []), ...revived])];
        roleToolsOff[role] = own.filter((x) => !on.includes(x));
        await ctrl.update({ roleToolsOff, toolsOff: ctrl.settings.toolsOff.filter((x) => !revived.includes(x)) });
      }
      if ((what === "on" || what === "off") && name) {
        if (!all.includes(name)) {
          ctrl.say("error", `no tool ${name}: ${all.join(", ")}`);
          return;
        }
        const off = new Set(ctrl.settings.toolsOff);
        if (what === "off") off.add(name);
        else off.delete(name);
        await ctrl.update({ toolsOff: [...off] });
      }
      const t = ctrl.topology;
      const rows: Line[] = [];
      for (const n of t?.nodes ?? []) {
        const policy = n.config.toolPolicy;
        const allowed = (policy?.allow ?? n.config.enabledTools ?? all).filter((x) => !ctrl.settings.toolsOff.includes(x) && !(ctrl.settings.roleToolsOff?.[n.id] ?? []).includes(x));
        rows.push(line([`  ${padCells(`${t!.faces[n.id]?.icon ?? "◦"} ${t!.faces[n.id]?.label ?? n.id}`, 12)} `, "b"], [allowed.length ? allowed.join(", ") : "no tools", allowed.length ? "ink" : "faint"]));
      }
      if (ctrl.settings.toolsOff.length) rows.push(plain(`  off for this session: ${ctrl.settings.toolsOff.join(", ")}`, "you"));
      rows.push(plain("  reads inside the working directories and read-only commands run; a write or any other command asks you first (/permissions)", "faint"));
      ctrl.info(rows, "tools");
    },
  },
  {
    name: "permissions",
    usage: "/permissions [list|mode <mode>|allow|ask|deny|remove <rule>]",
    summary: "the mode, the working directories and every rule, with the file it is in; add or remove a rule",
    complete: (args, ctrl) => {
      if (args.length <= 1) return ["list", "allow", "ask", "deny", "remove", "mode"];
      if (args[0] === "mode") return ["default", "acceptEdits", "plan"];
      if (args[0] === "remove") return [...ctrl.permissions.rules.allow, ...ctrl.permissions.rules.ask, ...ctrl.permissions.rules.deny];
      return ["Shell(", "Write(", "Read("];
    },
    run: async (args, ctrl, rest) => {
      let [what]: Array<string | undefined> = args;
      let rule = rest.slice(what?.length ?? 0).trim();
      if (!what) {
        const all = [...ctrl.permissions.rules.deny, ...ctrl.permissions.rules.ask, ...ctrl.permissions.rules.allow];
        const choice = await ctrl.pickOne("Permissions", [
          { value: "mode", label: "mode", detail: MODE_LABEL[ctrl.permissions.mode] },
          { value: "remove", label: "remove rules", detail: all.length ? `${all.length} rule${all.length > 1 ? "s" : ""}` : "no rules yet" },
          { value: "list", label: "show everything", detail: "the mode, the folders and every rule with its file" },
        ]);
        if (!choice) return;
        if (choice === "mode") {
          const m = await ctrl.pickOne(
            "The permission mode",
            (["default", "acceptEdits", "plan"] as const).map((x) => ({ value: x, label: x, detail: MODE_LABEL[x], current: x === ctrl.permissions.mode })),
          );
          if (!m) return;
          [what, rule] = ["mode", m];
        } else if (choice === "remove") {
          if (!all.length) return ctrl.info([plain("  no rules to remove: /permissions allow|ask|deny <rule> adds one", "dim")], "permissions");
          const sources = ruleSources(ctrl.workingDir);
          const gone = await ctrl.pick(
            "Rules to remove",
            all.map((r) => ({ value: r, label: r, detail: `${(["deny", "ask", "allow"] as const).find((k) => ctrl.permissions.rules[k].includes(r))} ∙ ${sources.find((x) => [...x.rules.allow, ...x.rules.ask, ...x.rules.deny].includes(r))?.label ?? "this session"}` })),
            { multi: true },
          );
          if (!gone?.length) return;
          for (const r of gone) await commandNamed("permissions")!.run(["remove", ...r.split(/\s+/)], ctrl, `remove ${r}`);
          return;
        } else what = "list";
      }
      if (what === "list") what = undefined;
      if (what === "mode") {
        if (!["default", "acceptEdits", "plan"].includes(rule)) {
          ctrl.say("error", rule === "bypassPermissions" ? "bypass is only ever --dangerously-skip-permissions, for one session" : "a mode is default, acceptEdits or plan");
          return;
        }
        ctrl.permissions.mode = rule as PermissionMode;
      } else if (what === "allow" || what === "ask" || what === "deny") {
        if (!parseRule(rule)) {
          ctrl.say("error", `a rule is Shell(<command>), Write(<path>) or Read(<path>), as Shell(npm test *) or Read(./.env); not ${rule || "nothing"}`);
          return;
        }
        saveLocalRules(ctrl.workingDir, { add: { list: what, rules: [rule] } });
        if (!ctrl.permissions.rules[what].includes(rule)) ctrl.permissions.rules[what].push(rule);
      } else if (what === "remove") {
        const from = ruleSources(ctrl.workingDir).filter((src) => src.label !== "local" && [...src.rules.allow, ...src.rules.ask, ...src.rules.deny].includes(rule));
        saveLocalRules(ctrl.workingDir, { remove: rule });
        for (const k of ["allow", "ask", "deny"] as const) ctrl.permissions.rules[k] = ctrl.permissions.rules[k].filter((r) => r !== rule || from.length > 0);
        ctrl.grants.rules.splice(0, ctrl.grants.rules.length, ...ctrl.grants.rules.filter((r) => r !== rule));
        if (from.length) ctrl.say("error", `${rule} is also in ${from.map((f) => f.file).join(" and ")}: Jig changes only .jig/settings.local.json, so edit that file to remove it`);
      } else if (what) {
        ctrl.say("error", "/permissions takes allow, ask, deny or remove and a rule, or mode and a mode");
        return;
      }
      const rows: Line[] = [line(["  mode ", "faint"], [MODE_LABEL[ctrl.permissions.mode], "b"], ["  (shift+tab cycles default, acceptEdits, plan)", "faint"])];
      rows.push(line(["  working directories ", "faint"], [ctrl.permissions.workingDirs.join(", "), "ink"]));
      const sources = ruleSources(ctrl.workingDir);
      const ruleW = Math.max(0, ...(["deny", "ask", "allow"] as const).flatMap((k) => ctrl.permissions.rules[k].map((r) => len(r))));
      for (const k of ["deny", "ask", "allow"] as const) {
        const all = ctrl.permissions.rules[k];
        rows.push(plain(`  ${k}${all.length ? "" : ": none"}`, "b"));
        for (const r of all) {
          const src = sources.find((x) => x.rules[k].includes(r));
          rows.push(line([`    ${padCells(r, ruleW)}  `, "ink"], [src ? src.label : "this session (--allow or --deny)", "faint"]));
        }
      }
      if (ctrl.grants.edits || ctrl.grants.rules.length) {
        rows.push(plain(`  for this session: ${[ctrl.grants.edits ? "all edits" : "", ...ctrl.grants.rules].filter(Boolean).join(" ∙ ")}`, "you"));
      }
      rows.push(plain("  deny wins over ask, and ask over allow, whichever file a rule is in; Jig writes only .jig/settings.local.json", "faint"));
      ctrl.info(rows, "permissions");
    },
  },
  {
    name: "add-dir",
    usage: "/add-dir <folder> [save]",
    summary: "let roles read and write in another folder, for this session or saved for the project",
    complete: (args, ctrl) => {
      const word = args.at(-1) ?? "";
      const dir = path.resolve(ctrl.workingDir, word.endsWith("/") ? word : path.dirname(word || "."));
      try {
        const base = word.endsWith("/") ? word : path.dirname(word) === "." && !word.startsWith(".") ? "" : `${path.dirname(word)}/`;
        return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => `${base}${e.name}/`);
      } catch {
        return [];
      }
    },
    run: (args, ctrl) => {
      const [folder, save] = args;
      if (!folder) {
        ctrl.info([line(["  working directories ", "faint"], [ctrl.permissions.workingDirs.join(", "), "ink"])], "add-dir");
        return;
      }
      const dir = path.resolve(ctrl.workingDir, folder.replace(/^~(?=\/|$)/, homedir()));
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        ctrl.say("error", `${folder} is not a folder`);
        return;
      }
      if (!ctrl.permissions.workingDirs.includes(dir)) ctrl.permissions.workingDirs.push(dir);
      if (save === "save") saveLocalRules(ctrl.workingDir, { addDir: dir });
      ctrl.info([plain(`  ${dir} is a working directory ${save === "save" ? "for this project (.jig/settings.local.json)" : "for this session"}: roles read there without asking, and writes there ask as they do here`, "ink")], "add-dir");
    },
  },
  {
    name: "sight",
    usage: "/sight [all|<role>]",
    summary: "what each role sees, measured with a mock model (no tokens)",
    complete: (args, ctrl) => (args.length <= 1 ? ["all", ...roleIds(ctrl)] : []),
    run: async (args, ctrl) => {
      if (!ctrl.topology) return;
      let [which] = args;
      if (!which) {
        const chosen = await ctrl.pickOne("Whose sight", [{ value: "all", label: "every role", detail: "the topology with its walls" }, ...roleItems(ctrl, false).map((r) => ({ ...r, detail: "what it sees, row by row" }))]);
        if (!chosen) return;
        which = chosen;
      }
      const sight = await measureSight(ctrl.configured(ctrl.topology));
      if (which !== "all") {
        const role = sight.roles.find((r) => r.id === which);
        if (!role) return ctrl.say("error", `no role ${which}: ${roleIds(ctrl).join(", ")}`);
        const rows: Line[] = sight.rows.map((row) => {
          const cell = sight.cells[row.key]?.[role.id] ?? "none";
          return line([cell === "none" ? "    " : "  ✓ ", cell === "none" ? "faint" : "b"], [padCells(row.label, 24), cell === "none" ? "faint" : "ink"], [SIGHT_SAYS[cell] ?? cell, "dim"]);
        });
        rows.push(plain(`  ${role.turns} turn${role.turns === 1 ? "" : "s"}, ${role.calls} model call${role.calls === 1 ? "" : "s"} in the probe; tools: ${role.tools?.join(", ") || "none"}`, "faint"));
        ctrl.info(rows, `what ${role.name} sees`);
        return;
      }
      const d = drawingOf(ctrl.configured(ctrl.topology), { sight, source: ctrl.topologySource });
      const width = Math.max(60, process.stdout.columns || 120);
      const g = draw(d, initialRunState(0), layoutFor(d, width, { sight: true }), { sight: true, width });
      ctrl.info(toText(g).split("\n").map((l) => plain(l, "ink")), `${ctrl.topology.name}: what each role sees`);
    },
  },
  {
    name: "checks",
    usage: "/checks [add <command>|file <path>|clear]",
    summary: "how the next task is checked: by the lab, where no role can write",
    complete: (args) => (args.length <= 1 ? ["add", "file", "clear"] : []),
    run: async (args, ctrl, rest) => {
      const [what] = args;
      if (what === "add") {
        const command = rest.replace(/^\s*add\s+/, "").trim();
        if (!command) return ctrl.say("error", "/checks add needs a command that exits 0 when the task is done");
        await ctrl.update({ checks: [...ctrl.settings.checks, { name: `check ${ctrl.settings.checks.length + 1}`, kind: "command", command }] });
      } else if (what === "file") {
        const file = args[1];
        if (!file || !existsSync(path.resolve(ctrl.workingDir, file))) return ctrl.say("error", `/checks file needs a file in ${ctrl.workingDir}`);
        await ctrl.update({ checkFiles: [...ctrl.settings.checkFiles, file] });
      } else if (what === "clear") await ctrl.update({ checks: [], checkFiles: [] });
      const rows: Line[] = ctrl.settings.checks.map((c) => line(["  ▪ ", "b"], [`${c.name}: `, "dim"], [c.kind === "command" ? c.command : c.kind, "ink"]));
      for (const f of ctrl.settings.checkFiles) rows.push(line(["  ▪ ", "b"], ["copied back before each check: ", "dim"], [f, "ink"]));
      rows.push(plain(rows.length ? "  for the next task only: the lab runs them after it, and its outcome is theirs" : "  no checks for the next task: /checks add <command>", "faint"));
      ctrl.info(rows, "checks");
    },
  },
  {
    name: "budget",
    usage: "/budget [<tokens>|off]",
    summary: "the tokens one task may spend",
    run: async (args, ctrl) => {
      const [what] = args;
      if (what === "off") await ctrl.update({ tokenBudget: undefined });
      else if (what) {
        const n = Number(what.replace(/k$/i, "000").replace(/_/g, ""));
        if (!(n > 0)) return ctrl.say("error", "/budget takes a number of tokens (40000 or 40k), or off");
        await ctrl.update({ tokenBudget: Math.round(n) });
      }
      ctrl.info([plain(ctrl.settings.tokenBudget ? `  each task may spend ${shortTokens(ctrl.settings.tokenBudget)} tokens; then it stops` : "  no token budget: a task stops at its round limit", "ink")], "budget");
    },
  },
  {
    name: "memory",
    usage: "/memory [session|task|shared|run|off]",
    summary: "how far back a run's recall reaches",
    complete: () => MEMORY_SCOPES,
    run: async (args, ctrl) => {
      let [what] = args;
      if (!what) {
        const chosen = await ctrl.pickOne("How far recall reaches", MEMORY_SCOPES.map((m) => ({ value: m, label: m, detail: MEMORY_WORDS[m], current: m === ctrl.settings.memoryScope })));
        if (!chosen) return;
        what = chosen;
      }
      if (what) {
        if (!MEMORY_SCOPES.includes(what as MemoryScope)) return ctrl.say("error", `/memory takes ${MEMORY_SCOPES.join(", ")}`);
        await ctrl.update({ memoryScope: what as MemoryScope });
      }
      ctrl.info([line(["  recall reaches ", "dim"], [ctrl.settings.memoryScope, "b"], [`: ${MEMORY_WORDS[ctrl.settings.memoryScope]}`, "dim"])], "memory");
    },
  },
  {
    name: "advisor",
    usage: "/advisor [model <entry/model>|limit <n>|sees <a,b>]",
    summary: "the consulted role: its model, its limit a turn, what it sees",
    complete: (args) => (args.length <= 1 ? ["model", "limit", "sees"] : args[0] === "sees" ? [...CONSULT_SIGHTS] : []),
    run: async (args, ctrl) => {
      const t = ctrl.topology;
      if (!t?.consults.length) {
        ctrl.info([plain(`  ${t?.name ?? "This topology"} has no consult edge; /topology advisor has one (Do consults an Advisor)`, "dim")], "advisor");
        return;
      }
      let [what, value] = args;
      if (!what) {
        const conf = ctrl.configured(t).consults[0];
        const current = ctrl.settings.advisor.model ?? (conf.role.brain?.model ? `${conf.role.brain.provider}/${conf.role.brain.model}` : ctrl.modelOf(""));
        const choice = await ctrl.pickOne(
          `${conf.role.face.label}, consulted by ${conf.from}`,
          [
            { value: "model", label: "model", detail: current },
            { value: "sees", label: "what it sees", detail: conf.sees.join(", ") },
          ],
          { hint: "/advisor limit <n> sets its limit a turn" },
        );
        if (!choice) return;
        if (choice === "model") {
          const chosen = await ctrl.pickOne(`The model or brain for ${conf.role.face.label}`, await modelItems(ctrl, current));
          if (!chosen) return;
          [what, value] = ["model", chosen];
        } else {
          const sees = await ctrl.pick(`What ${conf.role.face.label} sees`, CONSULT_SIGHTS.map((x) => ({ value: x, label: x })), { multi: true, checked: conf.sees });
          if (!sees) return;
          if (!sees.length) return ctrl.say("error", `${conf.role.face.label} has to see something: nothing was changed`);
          [what, value] = ["sees", sees.join(",")];
        }
      }
      if (what === "model" && value) {
        try {
          ctrl.models.provider(value);
        } catch (e) {
          return ctrl.say("error", (e as Error).message);
        }
        await ctrl.update({ advisor: { ...ctrl.settings.advisor, model: value } });
      } else if (what === "limit" && value) {
        const n = parseInt(value, 10);
        if (!(n > 0)) return ctrl.say("error", "/advisor limit takes a number above 0");
        await ctrl.update({ advisor: { ...ctrl.settings.advisor, limit: n } });
      } else if (what === "sees" && value) {
        const sees = value.split(",").map((x) => x.trim()) as ConsultSight[];
        const bad = sees.filter((x) => !CONSULT_SIGHTS.includes(x));
        if (bad.length) return ctrl.say("error", `/advisor sees takes ${CONSULT_SIGHTS.join(", ")}`);
        await ctrl.update({ advisor: { ...ctrl.settings.advisor, sees } });
      }
      const conf = ctrl.configured(t);
      const rows = conf.consults.map((c) =>
        line([`  ${c.role.face.icon} ${c.role.face.label} `, "b"], [`consulted by ${c.from}, at most ${c.limit} a turn, sees ${c.sees.join(", ")} ∙ `, "dim"], [c.role.brain?.model ? `${c.role.brain.provider}/${c.role.brain.model}` : ctrl.modelOf(""), "ink"]),
      );
      ctrl.info(rows, "advisor");
    },
  },
  {
    name: "providers",
    usage: "/providers [list|discover|keep <name>|test [name]|add <name> ...|remove <name>]",
    summary: "the provider entries, and the model servers found on this machine: where each is, where its key comes from (never the key)",
    complete: (args, ctrl) => (args.length <= 1 ? ["list", "discover", "keep", "test", "add", "remove"] : ctrl.models.entries()),
    run: async (args, ctrl) => {
      let [what = "", name, ...rest] = args;
      const models = ctrl.models as Partial<LoadedModels>;
      if (!what) {
        const states = models.states ?? [];
        if (!states.length) what = "list";
        else {
          const entry = await ctrl.pickOne(
            "Which provider entry",
            states.map((st) => ({ value: st.entry.name, label: st.entry.name, detail: st.discovered ? `found on this machine: ${st.discovered.label} ∙ ${st.discovered.models.length} model${st.discovered.models.length === 1 ? "" : "s"} ∙ not kept` : `${st.entry.kind} ∙ ${st.entry.baseUrl ?? "its default address"} ∙ ${st.key ? `key from ${st.source}` : needsKey(st.entry) ? "no key" : "no key needed"}${st.live ? ` ∙ up, ${st.live.length} models` : ""}` })),
            { hint: "/providers add <name> adds one ∙ /providers discover asks this machine again" },
          );
          if (!entry) return;
          const found = states.find((st) => st.entry.name === entry)?.discovered;
          const action = await ctrl.pickOne(
            entry,
            found
              ? [
                  { value: "keep", label: "keep", detail: `write it to your config, so it is there in every session (${found.label})` },
                  { value: "ignore", label: "ignore", detail: "leave it out of this session" },
                  { value: "test", label: "test", detail: "one real call, timed" },
                ]
              : [
                  { value: "test", label: "test", detail: "one real call, timed" },
                  { value: "remove", label: "remove", detail: "take it out of your config (a key in the keychain stays there)" },
                ],
          );
          if (!action) return;
          if (action === "remove") {
            const sure = await ctrl.pickOne(`Remove ${entry} from your config?`, [
              { value: "no", label: "No, keep it" },
              { value: "yes", label: `Yes, remove ${entry}` },
            ]);
            if (sure !== "yes") return;
          }
          [what, name] = [action, entry];
        }
      }
      const flag = (f: string) => {
        const i = rest.indexOf(f);
        return i >= 0 ? rest[i + 1] : undefined;
      };
      if (what === "discover") {
        ctrl.info([plain("  asking this machine's model servers (127.0.0.1 only)", "faint")]);
        await ctrl.discover();
        what = "list";
      } else if (what === "keep") {
        const st = (models.states ?? []).find((x) => x.entry.name === name && x.discovered);
        if (!st) return ctrl.say("error", `nothing discovered named ${name ?? ""}: /providers discover asks this machine again`);
        saveEntry({ name: st.entry.name, kind: st.entry.kind, ...(st.entry.baseUrl ? { baseUrl: st.entry.baseUrl } : {}), ...(st.entry.defaultModel ? { defaultModel: st.entry.defaultModel } : {}) });
        await ctrl.reload();
        what = "list";
      } else if (what === "ignore") {
        const i = (models.states ?? []).findIndex((x) => x.entry.name === name && x.discovered);
        if (i >= 0) models.states!.splice(i, 1);
        what = "list";
      }
      if (what === "test") {
        if (!models.states) return ctrl.say("error", "these models cannot be tested here");
        for (const n of name ? [name] : ctrl.models.entries()) {
          ctrl.info([line(["  ⋯ ", "faint"], [`testing ${n}: one real call`, "dim"])]);
          const r = await testOne(models as LoadedModels, n, flag("--model"));
          ctrl.info([line([r.ok ? "  ✓ " : "  ✗ ", r.ok ? "pass" : "fail"], [`${n} `, "b"], [r.ok ? `${r.ms} ms ∙ ${r.detail}` : r.detail, r.ok ? "dim" : "fail"])]);
        }
        return;
      }
      if (what === "add") {
        if (!name) return ctrl.say("error", "/providers add <name> [--kind k | --preset p] [--base-url u] [--key env:NAME | --key command:<program> | --keychain] [--default-model m]");
        const preset = flag("--preset");
        const kind = flag("--kind") ?? (preset ? "openai-compatible" : (ENTRY_KINDS as readonly string[]).includes(name) ? name : undefined);
        if (!kind || !(ENTRY_KINDS as readonly string[]).includes(kind)) return ctrl.say("error", `--kind is one of ${ENTRY_KINDS.join(", ")}, or give --preset (${Object.keys(PRESETS).join(", ")})`);
        let key = flag("--key");
        if (key?.startsWith("command:")) key = rest.slice(rest.indexOf("--key") + 1).join(" ").split(/ --(?:kind|preset|base-url|default-model)/)[0];
        if (rest.includes("--keychain") || (!key && ["anthropic", "openai", "gemini", "openrouter"].includes(kind) && !preset)) {
          // Typed without being shown, kept in the OS keychain, never in a file.
          const typed = await ctrl.askSecret(`${name}'s key: type or paste it, it is not shown`);
          if (!typed) return ctrl.say("error", "no key: nothing was saved");
          try {
            storeInKeychain(name, typed);
          } catch (e) {
            return ctrl.say("error", (e as Error).message);
          }
          key = "keychain";
        }
        try {
          saveEntry({ name, kind, ...(preset ? { preset } : {}), ...(flag("--base-url") ? { baseUrl: flag("--base-url") } : {}), ...(key ? { key } : {}), ...(flag("--default-model") ? { defaultModel: flag("--default-model") } : {}) });
        } catch (e) {
          return ctrl.say("error", (e as Error).message);
        }
        await ctrl.reload();
      } else if (what === "remove") {
        if (!name || !removeEntry(name)) return ctrl.say("error", `no entry ${name ?? ""} in your config`);
        await ctrl.reload();
      }
      const states = (ctrl.models as Partial<LoadedModels>).states ?? [];
      const rows: Line[] = states.map((st) =>
        line(
          [`  ${padCells(st.entry.name, 14)}`, "b"],
          [`${padCells(st.entry.kind, 18)} ${padCells(st.entry.baseUrl ?? "(its default)", 36)} `, "dim"],
          st.discovered
            ? [`found on this machine (${st.discovered.label}), ${st.discovered.models.length} model${st.discovered.models.length === 1 ? "" : "s"}, not kept: /providers keep ${st.entry.name}`, "you"]
            : models.localOnly && !models.isLocalRef?.(`${st.entry.name}/x`)
              ? ["cloud: refused here, this project is local-only", "fail"]
              : [`${models.isLocalRef?.(`${st.entry.name}/x`) ? "local" : "cloud"} ∙ ${st.key ? `key from ${st.source}` : !needsKey(st.entry) && st.source === "none" ? "no key needed" : st.source === "none" ? "no key" : `no key in ${st.source}`}${st.live ? ` ∙ up, ${st.live.length} models` : ""}`, st.key || !needsKey(st.entry) ? "faint" : "fail"],
        ),
      );
      const d = models.discovery;
      rows.push(plain(d ? `  this machine: ${d.summary} (127.0.0.1 only; a server elsewhere is added by hand)` : "  this machine has not been asked yet: /providers discover", "faint"));
      for (const w of (ctrl.models as Partial<LoadedModels>).warnings ?? []) rows.push(line(["  ! ", "you"], [w, "you"]));
      rows.push(plain(`  presets: ${Object.keys(PRESETS).join(", ")} ∙ /providers test <name> makes one real call`, "faint"));
      ctrl.info(rows, "providers");
    },
  },
  {
    name: "brains",
    usage: "/brains [list|set <name> <entry/model>...|test [name]]",
    summary: "named chains of models; a role on a brain falls back only when a provider is unavailable",
    complete: (args, ctrl) => (args.length <= 1 ? ["list", "set", "test"] : Object.keys((ctrl.models as Partial<LoadedModels>).brainsNow ?? {})),
    run: async (args, ctrl) => {
      let [what = "", name, ...chain] = args;
      const models = ctrl.models as Partial<LoadedModels>;
      if (!models.brainsNow) return ctrl.say("error", "no brains here");
      if (!what) {
        const chosen = await ctrl.pickOne(
          "Which brain to test: the model that would answer now",
          Object.entries(models.brainsNow).map(([b, c]) => ({ value: b, label: b, detail: c.join(" ⇢ ") || "no model in it" })),
          { hint: "/brains list prints them; /brains set <name> <model>... sets one" },
        );
        if (!chosen) return;
        [what, name] = ["test", chosen];
      }
      if (what === "set") {
        if (!name || !chain.length) return ctrl.say("error", "/brains set <name> <entry/model> [<entry/model>...]");
        try {
          saveBrain(name, chain);
        } catch (e) {
          return ctrl.say("error", (e as Error).message);
        }
        await ctrl.reload();
      }
      const lm = ctrl.models as LoadedModels;
      const brains = lm.brainsNow;
      const rows: Line[] = [];
      if (lm.localOnly) rows.push(plain("  this project is local-only: every brain runs on local models, and no cloud provider is used", "you"));
      const brainW = Math.max(0, ...Object.keys(brains).map((b) => len(b)));
      for (const [b, c] of Object.entries(brains)) {
        if (what === "test" && name && b !== name) continue;
        const now = what === "test" ? await resolveNow(lm, b) : null;
        // The privacy boundary: where a chain goes from local models to cloud ones, and whether a fallback may cross it.
        const local = lm.isLocalRef ? c.filter((r) => lm.isLocalRef(r)) : c;
        const crosses = c.some((r, i) => i > 0 && lm.isLocalRef?.(c[i - 1]) && !lm.isLocalRef(r));
        rows.push(line([`  ${padCells(b, brainW)}  `, "b"], [c.map((r) => (lm.isLocalRef?.(r) ? r : `${r} (cloud)`)).join("  ⇢  ") || "no model", c.length ? "ink" : "fail"]));
        if (crosses) rows.push(plain(`  ${padCells("", brainW)}  ${(lm.crossToCloud ?? []).includes(b) ? "may fall from a local model to the cloud: this brain says crossToCloud" : `stops before the cloud: a fallback from ${local.at(-1)} never goes on to a cloud model unless the brain says crossToCloud`}`, "faint"));
        if (now) rows.push(line([now.answers ? "    ✓ " : "    ✗ ", now.answers ? "pass" : "fail"], [now.answers ? `${now.answers} would answer now` : "nothing in it answers now", "dim"], [now.notes.length ? `  (${now.notes.join("; ")})` : "", "faint"]));
      }
      rows.push(plain("  /models <role> <brain> puts a role on one ∙ /brains test says which model would answer now", "faint"));
      ctrl.info(rows, "brains");
    },
  },
  {
    name: "runs",
    usage: "/runs [list]",
    summary: "the runs kept in this working directory: pick one to replay, or list them",
    complete: (args) => (args.length <= 1 ? ["list"] : []),
    run: async (args, ctrl) => {
      if (!args[0]) {
        const id = await pickRun(ctrl, "A past run to replay, newest first");
        if (id) await commandNamed("replay")!.run([id], ctrl, id);
        return;
      }
      const runs = await ctrl.pastRuns();
      if (!runs.length) return ctrl.info([plain("  no recorded runs here yet", "dim")], "runs");
      ctrl.info(
        [
          ...runs.map((r) => {
            const mark = r.outcome === "passed" ? "✓" : r.outcome === "failed" ? "✗" : "▪";
            const k: Meaning = r.outcome === "passed" ? "pass" : r.outcome === "failed" ? "fail" : "dim";
            return line([`  ${mark} `, k], [`${r.runId}  `, "b"], [`${padCells(r.topology, 18)} `, "dim"], [(r.task ?? "").replace(/\s+/g, " ").slice(0, 60), "ink"]);
          }),
          plain("  /runs picks one to replay ∙ /replay <run-id> plays one here", "faint"),
        ],
        "runs",
      );
    },
  },
  {
    name: "replay",
    usage: "/replay [<run-id>|last] [speed]",
    summary: "play a past run on this screen, from its step records: pick one, or name it",
    complete: async (_args, ctrl) => ["last", ...(await ctrl.pastRuns(30)).map((r) => r.runId)],
    run: async (args, ctrl) => {
      const [runId, speed] = args;
      const id = !runId ? await pickRun(ctrl, "A past run to replay, newest first") : runId === "last" ? (await ctrl.pastRuns(1))[0]?.runId : runId;
      if (!id) return runId ? ctrl.say("error", "no recorded run to replay: /runs lists them") : undefined;
      try {
        await ctrl.openReplay(id, speed ? Math.max(0.1, Number(speed)) || 4 : 4);
      } catch (e) {
        ctrl.say("error", (e as Error).message);
      }
    },
  },
  {
    name: "clear",
    usage: "/clear",
    summary: "start the conversation again; settings stay",
    run: async (_args, ctrl) => {
      await ctrl.clear();
    },
  },
  {
    name: "quit",
    usage: "/quit",
    summary: "leave; jig --resume opens this session again",
    run: (_args, ctrl) => {
      ctrl.emit("exit");
    },
  },
];

export const commandNamed = (name: string): SlashCommand | undefined => COMMANDS.find((c) => c.name === name || (name === "exit" && c.name === "quit"));

/** Split a slash command into its name, words and the text after the name. */
export function parseSlash(text: string): { name: string; args: string[]; rest: string } {
  const body = text.trim().slice(1);
  const name = body.split(/\s+/)[0] ?? "";
  const rest = body.slice(name.length).trim();
  return { name, args: rest ? rest.split(/\s+/) : [], rest };
}

/** Completions for what is typed: command names, then a command's arguments. */
export async function completions(text: string, ctrl: SessionController): Promise<{ items: string[]; word: string }> {
  if (!text.startsWith("/") || text.includes("\n")) return { items: [], word: "" };
  const hasSpace = /\s/.test(text);
  if (!hasSpace) {
    const word = text.slice(1);
    return { items: COMMANDS.map((c) => c.name).filter((n) => n.startsWith(word)), word };
  }
  const { name, args } = parseSlash(text);
  const cmd = commandNamed(name);
  if (!cmd?.complete) return { items: [], word: "" };
  const endsWithSpace = /\s$/.test(text);
  const word = endsWithSpace ? "" : (args.at(-1) ?? "");
  const before = endsWithSpace ? args : args.slice(0, -1);
  const all = await cmd.complete([...before, word], ctrl);
  return { items: [...new Set(all)].filter((x) => x.startsWith(word) && x !== word).slice(0, 40), word };
}

/** Run a slash command; an unknown one says so. */
export async function runSlash(text: string, ctrl: SessionController): Promise<void> {
  const { name, args, rest } = parseSlash(text);
  const cmd = commandNamed(name);
  if (!cmd) {
    ctrl.say("error", `no command /${name}: /help lists them`);
    return;
  }
  try {
    await cmd.run(args, ctrl, rest);
  } catch (e) {
    ctrl.say("error", `/${name}: ${(e as Error).message}`);
  }
}
