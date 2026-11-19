// ============================================
// The session's screen, in Ink
// ============================================
// Fixed regions, top to bottom: the topology live on its grid (Ctrl+T folds
// it to its one-line strip), the conversation, a question waiting for you
// when a role asks to run a command, the input with its completions, and
// the two-line footer. Every region is computed as lines first (lines.ts),
// so the screen is exactly as tall as the terminal and never scrolls.

import React, { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { drawingBlock, footer, initialRunState, type Meaning } from "jig-core";
import type { Line, SessionController } from "./controller.js";
import { conversationLines, gridLines, welcomeLines, wrapLine } from "./lines.js";
import { emptyEditor, edit, cursorAt, type EditorState } from "./editor.js";
import { decode, type SessionKey } from "./keys.js";
import { completions, runSlash } from "./commands.js";
import { theme, workingFrames } from "./theme.js";
import { toAscii } from "./ascii.js";

export interface AppProps {
  ctrl: SessionController;
  version: string;
  /** No styles at all. */
  plain?: boolean;
  /** ASCII instead of the glyphs. */
  ascii?: boolean;
  /** The terminal's size; read from stdout when absent. */
  size?: { columns: number; rows: number };
  /** Play the startup animation (default true). */
  splash?: boolean;
  resumed?: boolean;
  /** Earlier inputs, for the history. */
  history?: string[];
  /** Called with each input sent, to keep the history. */
  onSubmit?: (text: string) => void;
  /** Redraws a second while something moves (default 10). */
  fps?: number;
}

const MAX_INPUT_LINES = 6;
const MAX_MENU = 6;

function useSize(fixed?: { columns: number; rows: number }): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => fixed ?? { columns: stdout.columns || 100, rows: stdout.rows || 30 };
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (fixed) return;
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout, fixed?.columns, fixed?.rows]);
  return fixed ?? size;
}

/** The input's lines: the prompt on the first, the cursor drawn as a cell. */
function inputLines(ed: EditorState, width: number, ascii: boolean, plain: boolean, hint: string): Line[] {
  const prompt = ascii ? theme.prompt.ascii : theme.prompt.unicode;
  const rows = ed.text.split("\n");
  const { line, col } = cursorAt(ed);
  const out: Line[] = [];
  rows.forEach((row, i) => {
    const lead: [string, Meaning] = [i === 0 ? `${prompt} ` : "  ", "b"];
    if (i !== line) {
      out.push(...wrapLine([lead, [row, "ink"]], width, "  "));
      return;
    }
    const chars = [...row];
    const at = [...row.slice(0, col)].length;
    const under = chars[at] ?? " ";
    // The cursor is a cell in inverse; with no styles it is drawn as a block.
    const cursor: [string, Meaning] = plain ? [ascii ? theme.cursor.ascii : theme.cursor.unicode, "ink"] : [under, "cursor" as Meaning];
    out.push(...wrapLine([lead, [chars.slice(0, at).join(""), "ink"], cursor, [chars.slice(at + (plain ? 0 : 1)).join(""), "ink"]], width, "  "));
  });
  if (!ed.text && hint) out[0] = [out[0][0], ...(plain ? [[ascii ? theme.cursor.ascii : theme.cursor.unicode, "ink"] as [string, Meaning]] : [[" ", "cursor" as Meaning] as [string, Meaning]]), [hint, "faint"]];
  return out;
}

/** A line cut to the width, so Ink never wraps it or adds its own ellipsis. */
function clip(line: Line, width: number, ascii: boolean): Line {
  const out: Line = [];
  let left = width;
  for (const [t, k] of line) {
    if (left <= 0) break;
    const chars = [...t];
    if (chars.length <= left) {
      out.push([t, k]);
      left -= chars.length;
    } else {
      out.push([chars.slice(0, Math.max(0, left - 1)).join("") + (ascii ? "~" : "…"), k]);
      left = 0;
    }
  }
  return out;
}

function StyledLines({ lines, plain, ascii, width }: { lines: Line[]; plain: boolean; ascii: boolean; width: number }) {
  return (
    <>
      {lines.map((full, i) => clip(full, width, ascii)).map((l, i) => (
        <Text key={i} wrap="truncate-end">
          {l.length === 0 ? " " : null}
          {l.map(([t, k], j) => {
            const text = ascii ? toAscii(t) : t;
            if (k === ("cursor" as Meaning)) return <Text key={j} inverse>{text}</Text>;
            if (plain) return <Text key={j}>{text}</Text>;
            const st = theme.styles[k as Meaning] ?? {};
            return (
              <Text key={j} {...(st.color ? { color: st.color } : {})} bold={Boolean(st.bold)} dimColor={Boolean(st.dim)}>
                {text}
              </Text>
            );
          })}
        </Text>
      ))}
    </>
  );
}

export function App(props: AppProps) {
  const { ctrl, version } = props;
  const plain = Boolean(props.plain);
  const ascii = Boolean(props.ascii);
  const { columns, rows } = useSize(props.size);
  const { exit } = useApp();
  const { internal_eventEmitter, setRawMode, isRawModeSupported } = useStdin();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [ed, setEdState] = useState<EditorState>(() => emptyEditor(props.history ?? []));
  const edRef = useRef(ed);
  // Several keys can arrive in one event: each must see the editor the one before left.
  const setEd = (next: EditorState) => {
    edRef.current = next;
    setEdState(next);
  };
  const [menu, setMenu] = useState<{ items: string[]; word: string; at: number }>({ items: [], word: "", at: 0 });
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [scroll, setScroll] = useState(0);
  const [splashAt, setSplashAt] = useState(props.splash === false ? -1 : 0);
  const [now, setNow] = useState(Date.now());
  const pasting = useRef(false);
  const lastCtrlC = useRef(0);
  const [hint, setHint] = useState("");

  // Redraw on every change of the session, and a few times a second while something moves.
  useEffect(() => {
    const on = () => bump();
    ctrl.on("change", on);
    const onExit = () => {
      ctrl.shutdown();
      exit();
    };
    ctrl.on("exit", onExit);
    return () => {
      ctrl.off("change", on);
      ctrl.off("exit", onExit);
    };
  }, [ctrl]);
  const moving = Boolean(ctrl.running || ctrl.replay?.playing) || splashAt >= 0;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => setNow(Date.now()), Math.round(1000 / (props.fps ?? 10)));
    return () => clearInterval(t);
  }, [moving, props.fps]);
  useEffect(() => {
    if (splashAt < 0) return;
    if (splashAt >= theme.startup.frames.length) {
      setSplashAt(-1);
      return;
    }
    const t = setTimeout(() => setSplashAt((n) => n + 1), theme.startup.interval);
    return () => clearTimeout(t);
  }, [splashAt]);

  // Completions follow what is typed.
  useEffect(() => {
    let live = true;
    if (!ed.text.startsWith("/")) {
      if (menuRef.current.items.length) setMenu({ items: [], word: "", at: 0 });
      return;
    }
    completions(ed.text, ctrl).then((c) => {
      if (live) setMenu({ ...c, at: 0 });
    });
    return () => {
      live = false;
    };
  }, [ed.text, ctrl]);

  const submit = (text: string) => {
    props.onSubmit?.(text);
    setScroll(0);
    if (text.trim().startsWith("/")) void runSlash(text.trim(), ctrl);
    else void ctrl.send(text);
  };

  const onKey = (key: SessionKey) => {
    setHint("");
    // A question waiting for you takes the keys first.
    if (ctrl.approvals.length) {
      if (key.kind === "text" && /^[1y]$/i.test(key.text)) ctrl.answer("once");
      else if (key.kind === "text" && /^[2a]$/i.test(key.text)) ctrl.answer("session");
      else if ((key.kind === "text" && /^[3n]$/i.test(key.text)) || key.kind === "escape") ctrl.answer("deny");
      else if (key.kind === "ctrl" && key.letter === "c") ctrl.interrupt();
      return;
    }
    const e = edRef.current;
    // A replay takes space, the right arrow and Esc while the input is empty.
    if (ctrl.replay && !e.text) {
      if (key.kind === "text" && key.text === " ") return ctrl.toggleReplay();
      if (key.kind === "right") return ctrl.replayStep();
      if (key.kind === "escape" || (key.kind === "text" && key.text === "q")) return ctrl.closeReplay();
    }
    const m = menuRef.current;
    if (m.items.length && (key.kind === "tab" || ((key.kind === "up" || key.kind === "down") && !e.text.includes("\n")))) {
      if (key.kind === "tab") {
        const pick = m.items[m.at];
        const base = e.text.slice(0, e.text.length - m.word.length);
        const text = `${base}${pick} `;
        setEd({ ...e, text, cursor: text.length });
      } else setMenu({ ...m, at: (m.at + (key.kind === "down" ? 1 : m.items.length - 1)) % m.items.length });
      return;
    }
    switch (key.kind) {
      case "paste-start":
        pasting.current = true;
        return;
      case "paste-end":
        pasting.current = false;
        return;
      case "escape":
        if (m.items.length) setMenu({ items: [], word: "", at: 0 });
        else if (!ctrl.interrupt() && e.text) setEd({ ...e, text: "", cursor: 0 });
        return;
      case "pageup":
        setScroll((n) => n + Math.max(1, Math.floor(rows / 2)));
        return;
      case "pagedown":
        setScroll((n) => Math.max(0, n - Math.max(1, Math.floor(rows / 2))));
        return;
      case "shift-tab":
      case "tab":
      case "ignore":
        return;
      case "ctrl":
        if (key.letter === "t") ctrl.toggleFold();
        else if (key.letter === "c") {
          if (ctrl.running) ctrl.interrupt();
          else if (e.text) setEd({ ...e, text: "", cursor: 0 });
          else if (Date.now() - lastCtrlC.current < 2000) ctrl.emit("exit");
          else {
            lastCtrlC.current = Date.now();
            setHint("press Ctrl+C again to quit, or /quit");
          }
        } else if (key.letter === "d" && !e.text) ctrl.emit("exit");
        else if (key.letter === "l") bump();
        return;
      default: {
        const r = edit(e, key);
        setEd(r.state);
        if (r.submitted !== undefined) submit(r.submitted);
      }
    }
  };

  useEffect(() => {
    if (!internal_eventEmitter) return;
    if (isRawModeSupported) setRawMode(true);
    const onInput = (data: string) => {
      for (const k of decode(data, pasting.current)) onKey(k);
    };
    internal_eventEmitter.on("input", onInput);
    return () => {
      internal_eventEmitter.off("input", onInput);
      if (isRawModeSupported) setRawMode(false);
    };
  }, [internal_eventEmitter]);

  // ---- The regions, as lines ----
  const width = Math.max(30, columns);
  const height = Math.max(8, rows - 1);
  const replay = ctrl.replay;
  const drawing = replay?.drawing ?? ctrl.drawing;
  const state = replay?.state ?? ctrl.runState ?? initialRunState(0);
  const spinFrames = workingFrames(ascii);
  const spin = spinFrames[Math.floor(now / theme.indicators.working.interval) % spinFrames.length];

  const footerLines = drawing
    ? gridLines(
        footer(drawing, state, width, {
          spin,
          command: `jig · ${drawing.id} · ${ctrl.modelOf("")}`,
          extra: replay
            ? `replay ${replay.runId} · event ${replay.next} of ${replay.events.length}${replay.finished ? " · the end · esc closes" : replay.playing ? ` · ▶ ×${replay.speed} · space pauses` : " · ‖ paused · → steps"}`
            : ctrl.running
              ? "esc stops · type to steer"
              : "/help · ctrl+t folds",
        }),
      )
    : [];
  const approval = ctrl.approvals[0];
  const approvalLines: Line[] = approval
    ? [
        [["  ‖ ", "you"], [`${approval.roleName} asks to run `, "you"], [approval.command, "b"]],
        [[`    ${approval.programs.join(", ")} ${approval.programs.length > 1 ? "are" : "is"} not on its allow-list; everything else in it was checked`, "faint"]],
        [["    1 ", "b"], ["allow once   ", "ink"], ["2 ", "b"], ["allow this command for the session   ", "ink"], ["3 ", "b"], ["deny (esc)", "ink"]],
      ]
    : [];
  const placeholder = ctrl.running ? "type to steer the run, esc stops it" : replay ? "space pauses, → steps, esc closes the replay" : "a task for the topology, or /help";
  const inLines = inputLines(ed, width, ascii, plain, hint || placeholder).slice(-MAX_INPUT_LINES);
  const menuLines: Line[] = menu.items.slice(0, MAX_MENU).map((item, i): Line => [[i === menu.at ? "  ▸ " : "    ", i === menu.at ? "b" : "faint"], [item, i === menu.at ? "b" : "dim"]]);
  const rule: Line = [["─".repeat(width), "faint"]];
  const fixed = footerLines.length + inLines.length + 1 + menuLines.length + approvalLines.length;
  const room = Math.max(3, height - fixed);
  const gridRoom = Math.max(1, Math.floor(room / 2));
  const block = drawing ? drawingBlock(drawing, state, { width, maxRows: gridRoom, layout: ctrl.folded ? "strip" : "auto", spin }) : null;
  const gLines = block ? gridLines(block.grid).slice(0, gridRoom) : [];
  const convRoom = Math.max(1, room - gLines.length - (gLines.length ? 1 : 0));

  let convLines: Line[];
  if (splashAt >= 0) {
    const frame = theme.startup.frames[Math.min(splashAt, theme.startup.frames.length - 1)];
    convLines = (ascii ? frame.ascii : frame.unicode).map((l): Line => [[`  ${l}`, "b"]]);
  } else {
    convLines = [...welcomeLines(ctrl, version, ascii, Boolean(props.resumed)), [], ...conversationLines(ctrl, width, now, ascii)];
  }
  const maxScroll = Math.max(0, convLines.length - convRoom);
  const off = Math.min(scroll, maxScroll);
  const shown = convLines.slice(Math.max(0, convLines.length - convRoom - off), convLines.length - off);
  if (off > 0 && shown.length) shown[shown.length - 1] = [[`  ↓ ${off} more line${off > 1 ? "s" : ""} below · PgDn`, "b"]];
  while (shown.length < convRoom) shown.push([]);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <StyledLines lines={gLines} plain={plain} ascii={ascii} width={width} />
      {gLines.length ? <StyledLines lines={[rule]} plain={plain} ascii={ascii} width={width} /> : null}
      <StyledLines lines={shown} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={approvalLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={[rule]} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={inLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={menuLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={footerLines} plain={plain} ascii={ascii} width={width} />
    </Box>
  );
}
