// ============================================
// jig with no subcommand: the interactive session
// ============================================
// Opens the alternate screen with bracketed paste on, renders the session,
// and gives the terminal back as it was on any exit. The session file and
// the input history live in .jig/ (sessions/ and history.jsonl).

import { appendFile, readFile } from "node:fs/promises";
import * as path from "node:path";
import { loadPermissions } from "../permissions.js";
import React from "react";
import { render } from "ink";
import { createStorage, ensureProjectDir, existingProjectPath, loadConfig, projectPath } from "jig-core";
import { App } from "./app.js";
import { SessionController, savedSessions, type SessionSettings } from "./controller.js";
import { loadModels } from "../providers.js";
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON } from "./keys.js";
import { wantsAscii } from "./ascii.js";
import { ambiguousIsWide } from "../terminal-width.js";
import { addKey, addServer } from "./first-run.js";

export interface SessionOptions {
  resume?: string | boolean;
  topology?: string;
  provider?: string;
  model?: string;
  dir?: string;
  plain?: boolean;
  ascii?: boolean;
  permissionMode?: string;
  addDir?: string[];
  dangerouslySkipPermissions?: boolean;
}

const ENTER = "\x1b[?1049h\x1b[?25l";

/**
 * How the session opens: Jig's startup animation, a static frame under
 * --plain, or nothing off a terminal, in a terminal too small for it, or when
 * the config (ui.startup: false) or JIG_STARTUP=off turns it off.
 */
export function startupModeFor(o: { tty: boolean; plain: boolean; columns: number; rows: number; config?: boolean; env?: NodeJS.ProcessEnv }): "animate" | "static" | "off" {
  if (!o.tty) return "off";
  if (o.config === false || (o.env ?? process.env).JIG_STARTUP === "off") return "off";
  if (o.columns < 40 || o.rows < 16) return "off";
  return o.plain ? "static" : "animate";
}
const LEAVE = "\x1b[?25h\x1b[?1049l";

async function readHistory(workingDir: string): Promise<string[]> {
  const file = existingProjectPath(workingDir, "history.jsonl");
  if (!file) return [];
  try {
    return (await readFile(file, "utf-8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => String((JSON.parse(l) as { text?: unknown }).text ?? ""))
      .filter(Boolean)
      .slice(-500);
  } catch {
    return [];
  }
}

export async function startSession(options: SessionOptions, version: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("jig opens a session in a terminal. For a script, use jig run (jig --help lists the commands).\n");
    process.exitCode = 2;
    return;
  }
  process.env.JIG_LOG_LEVEL ??= "error";
  const workingDir = path.resolve(options.dir ?? ".");
  const config = await loadConfig(workingDir);
  const models = await loadModels(config, { provider: options.provider, model: options.model });
  let resume = undefined;
  if (options.resume) {
    const all = await savedSessions(workingDir);
    resume = typeof options.resume === "string" ? all.find((s) => s.id === options.resume || s.id.endsWith(String(options.resume))) : all[0];
    if (!resume) {
      process.stderr.write(typeof options.resume === "string" ? `No session ${options.resume} in ${workingDir}.\n` : `No session to resume in ${workingDir}: jig starts one.\n`);
      if (typeof options.resume === "string") {
        process.exitCode = 2;
        return;
      }
    }
  }
  const settings: Partial<SessionSettings> = {
    ...(options.topology ? { topology: options.topology } : {}),
    ...(options.model || options.provider ? { defaultModel: models.defaultRef } : {}),
  };
  let permissions;
  try {
    permissions = loadPermissions(workingDir, { mode: options.permissionMode, skip: options.dangerouslySkipPermissions, addDirs: options.addDir });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  const storage = await createStorage(config.storage).catch(() => null);
  const ctrl = new SessionController({
    permissions,
    addKey,
    addServer,
    workingDir,
    models,
    storage,
    settings,
    unescapeNewlines: config.tools?.unescapeNewlines !== false,
    reloadModels: async () => loadModels(await loadConfig(workingDir), { provider: options.provider, model: options.model }),
    ...(resume ? { resume } : {}),
  });
  await ctrl.load();
  // This machine's model servers are asked in the background: the session opens at once, and says what answered.
  void ctrl.prepare();
  await ctrl.save().catch(() => {});

  const history = await readHistory(workingDir);
  const historyFile = projectPath(workingDir, "history.jsonl");
  const keep = (text: string) => {
    void ensureProjectDir(workingDir)
      .then(() => appendFile(historyFile, `${JSON.stringify({ text, at: new Date().toISOString(), session: ctrl.id })}\n`))
      .catch(() => {});
  };

  const restore = () => process.stdout.write(BRACKETED_PASTE_OFF + LEAVE);
  process.once("exit", restore);
  process.stdout.write(ENTER + BRACKETED_PASTE_ON);
  const plain = Boolean(options.plain) || Boolean(process.env.NO_COLOR);
  const startup = startupModeFor({ tty: Boolean(process.stdout.isTTY), plain, columns: process.stdout.columns || 80, rows: process.stdout.rows || 24, config: config.ui?.startup });
  // A terminal that draws ambiguous characters two cells wide would push every box border out of line: it gets ASCII.
  const ascii = wantsAscii(options.ascii) || (await ambiguousIsWide()) === true;
  const app = render(React.createElement(App, { ctrl, version, plain, ascii, resumed: Boolean(resume), history, onSubmit: keep, startup }), {
    exitOnCtrlC: false,
    patchConsole: true,
    // Ink 6.8's incremental mode moves the cursor up one line short after a frame that ends with a newline,
    // so the screen drifts down a row and scrolls; the whole frame is redrawn instead, inside a synchronized update.
    incrementalRendering: false,
  });
  const onSignal = () => {
    ctrl.shutdown();
    app.unmount();
  };
  process.on("SIGTERM", onSignal);
  try {
    await app.waitUntilExit();
  } finally {
    process.off("SIGTERM", onSignal);
    ctrl.shutdown();
    await ctrl.save().catch(() => {});
    restore();
    process.off("exit", restore);
    await storage?.close().catch(() => {});
    process.stdout.write(`session ${ctrl.id} kept in ${path.relative(workingDir, ctrl.file) || ctrl.file} ∙ jig --resume opens it again\n`);
  }
}
