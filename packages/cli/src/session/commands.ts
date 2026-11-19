// ============================================
// The session's slash commands
// ============================================
// Each command names itself, says what it does, completes its arguments, and
// writes what it has to say into the conversation. Settings a command
// changes take effect on the next task and are kept with the session.

import { existsSync, readdirSync } from "node:fs";
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
} from "jig-core";
import type { Line, SessionController } from "./controller.js";

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
  const rows: Line[] = [];
  for (const n of t.nodes) {
    const face = t.faces[n.id];
    const own = ctrl.settings.roleModels[n.id];
    rows.push(line([`  ${face?.icon ?? "◇"} ${(face?.label ?? n.id).padEnd(10)} `, "b"], [`${n.id.padEnd(8)} `, "faint"], [ctrl.modelOf(n.id), own ? "ink" : "dim"], [own ? "" : "  (the default)", "faint"]));
  }
  for (const c of t.consults) {
    const model = ctrl.settings.advisor.model ?? ctrl.settings.roleModels[c.role.id] ?? (c.role.brain?.model ? `${c.role.brain.provider ?? ""}/${c.role.brain.model}` : ctrl.modelOf(""));
    rows.push(line([`  ${c.role.face.icon} ${c.role.face.label.padEnd(10)} `, "b"], [`${c.role.id.padEnd(8)} `, "faint"], [model, "ink"], [`  consulted by ${c.from}`, "faint"]));
  }
  return rows;
}

export const COMMANDS: SlashCommand[] = [
  {
    name: "help",
    usage: "/help",
    summary: "what each command does, and the keys",
    run: (_args, ctrl) => {
      const rows: Line[] = COMMANDS.map((c) => line([`  ${c.usage.padEnd(34)} `, "b"], [c.summary, "dim"]));
      rows.push(plain(""));
      rows.push(plain("  Enter sends · Alt+Enter, Ctrl+J or \\ then Enter start a new line · ↑↓ history · Tab completes", "dim"));
      rows.push(plain("  Typing while a run goes steers it (a note Do reads on its next turn) · Esc stops the run", "dim"));
      rows.push(plain("  Ctrl+T folds the topology to one line · PgUp PgDn scroll the conversation · Ctrl+D quits", "dim"));
      ctrl.info(rows, "help");
    },
  },
  {
    name: "topology",
    usage: "/topology [list|show|<id or file>]",
    summary: "the topology each task runs through: list them, draw it, or switch",
    complete: (args, ctrl) => (args.length <= 1 ? ["list", "show", ...listRecipes().map((r) => r.id), ...topologyFiles(ctrl.workingDir)] : []),
    run: async (args, ctrl) => {
      const [what] = args;
      if (!what || what === "list") {
        const rows = listRecipes().map((r) => line([r.id === ctrl.topology?.id ? "  ● " : "    ", r.id === ctrl.topology?.id ? "run" : "faint"], [r.id.padEnd(22), "b"], [`${r.nodes.length} role${r.nodes.length > 1 ? "s" : ""}  `, "dim"], [r.name, "ink"]));
        rows.push(plain("  /topology <id> switches; a .yaml or .json file works too", "faint"));
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
    usage: "/models [list|<role> <entry/model>|default <entry/model>]",
    summary: "a model per role, from any configured provider",
    complete: async (args, ctrl) => {
      if (args.length <= 1) return ["list", "default", ...roleIds(ctrl)];
      const lists = await ctrl.models.list().catch(() => []);
      return lists.flatMap((l) => l.models.map((m) => `${l.entry}/${m}`));
    },
    run: async (args, ctrl) => {
      const [what, ref] = args;
      if (!what) {
        ctrl.info([...roleTable(ctrl), plain("  /models list shows what each provider has; /models <role> <entry/model> sets one", "faint")], "models");
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
    usage: "/tools [on|off <tool>]",
    summary: "each role's tools and shell programs; turn a tool off for the session",
    complete: (args) => (args.length <= 1 ? ["on", "off"] : createDefaultToolkit().getAll().map((t) => t.definition.name)),
    run: async (args, ctrl) => {
      const [what, name] = args;
      const all = createDefaultToolkit().getAll().map((t) => t.definition.name);
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
        const allowed = (policy?.allow ?? n.config.enabledTools ?? all).filter((x) => !ctrl.settings.toolsOff.includes(x));
        rows.push(line([`  ${t!.faces[n.id]?.icon ?? ""} ${(t!.faces[n.id]?.label ?? n.id).padEnd(10)}`, "b"], [allowed.length ? allowed.join(", ") : "no tools", allowed.length ? "ink" : "faint"]));
        if (allowed.includes("shell")) rows.push(plain(`      shell runs: ${(policy?.commands ?? DEFAULT_SHELL_COMMANDS).join(" ")}`, "faint"));
      }
      if (ctrl.settings.toolsOff.length) rows.push(plain(`  off for this session: ${ctrl.settings.toolsOff.join(", ")}`, "you"));
      rows.push(plain(ctrl.allowed.size ? `  allowed for this session: ${[...ctrl.allowed].join(" · ")}` : "  a command off a role's list asks you first: once, for the session, or no", "faint"));
      ctrl.info(rows, "tools");
    },
  },
  {
    name: "sight",
    usage: "/sight",
    summary: "what each role sees, measured with a mock model (no tokens)",
    run: async (_args, ctrl) => {
      if (!ctrl.topology) return;
      const sight = await measureSight(ctrl.configured(ctrl.topology));
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
      const rows: Line[] = ctrl.settings.checks.map((c) => line(["  ■ ", "b"], [`${c.name}: `, "dim"], [c.kind === "command" ? c.command : c.kind, "ink"]));
      for (const f of ctrl.settings.checkFiles) rows.push(line(["  ■ ", "b"], ["copied back before each check: ", "dim"], [f, "ink"]));
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
    usage: "/memory [session|task|shared|off]",
    summary: "how far back a run's recall reaches",
    complete: () => MEMORY_SCOPES,
    run: async (args, ctrl) => {
      const [what] = args;
      if (what) {
        if (!MEMORY_SCOPES.includes(what as MemoryScope)) return ctrl.say("error", `/memory takes ${MEMORY_SCOPES.join(", ")}`);
        await ctrl.update({ memoryScope: what as MemoryScope });
      }
      const words: Record<MemoryScope, string> = {
        session: "this session's runs: the conversation so far, and what its runs kept",
        task: "runs of the same task, in any session",
        shared: "everything kept, across tasks",
        run: "only what the run itself writes",
        off: "nothing: each task starts with no memory, and the conversation is still its input",
      };
      ctrl.info([line(["  recall reaches ", "dim"], [ctrl.settings.memoryScope, "b"], [`: ${words[ctrl.settings.memoryScope]}`, "dim"])], "memory");
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
      const [what, value] = args;
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
        line([`  ${c.role.face.icon} ${c.role.face.label} `, "b"], [`consulted by ${c.from}, at most ${c.limit} a turn, sees ${c.sees.join(", ")} · `, "dim"], [c.role.brain?.model ? `${c.role.brain.provider}/${c.role.brain.model}` : ctrl.modelOf(""), "ink"]),
      );
      ctrl.info(rows, "advisor");
    },
  },
  {
    name: "runs",
    usage: "/runs",
    summary: "the runs kept in this working directory",
    run: async (_args, ctrl) => {
      const runs = await ctrl.pastRuns();
      if (!runs.length) return ctrl.info([plain("  no recorded runs here yet", "dim")], "runs");
      ctrl.info(
        [
          ...runs.map((r) => {
            const mark = r.outcome === "passed" ? "✓" : r.outcome === "failed" ? "✗" : "■";
            const k: Meaning = r.outcome === "passed" ? "pass" : r.outcome === "failed" ? "fail" : "dim";
            return line([`  ${mark} `, k], [`${r.runId}  `, "b"], [`${r.topology.padEnd(18)} `, "dim"], [(r.task ?? "").replace(/\s+/g, " ").slice(0, 60), "ink"]);
          }),
          plain("  /replay <run-id> plays one here", "faint"),
        ],
        "runs",
      );
    },
  },
  {
    name: "replay",
    usage: "/replay <run-id> [speed]",
    summary: "play a past run on this screen, from its step records",
    complete: async (_args, ctrl) => (await ctrl.pastRuns(30)).map((r) => r.runId),
    run: async (args, ctrl) => {
      const [runId, speed] = args;
      const id = runId ?? (await ctrl.pastRuns(1))[0]?.runId;
      if (!id) return ctrl.say("error", "no recorded run to replay: /runs lists them");
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
