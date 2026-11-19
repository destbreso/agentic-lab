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
import { drawingBlock, footer, initialRunState, type Meaning, type PermissionQuestion } from "jig-core";
import type { Line, SessionController } from "./controller.js";
import { approvalChoices, approvalLines, conversationLines, footerHead, gridLines, headerLines, pickerLines, welcomeLines, wrapLine } from "./lines.js";
import { emptyEditor, edit, cursorAt, type EditorState } from "./editor.js";
import { decode, type SessionKey } from "./keys.js";
import { commandNamed, completions, runSlash } from "./commands.js";
import { startupMs, startupRows, theme, workingSpin } from "./theme.js";
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
  /** The startup: animated (any key skips it), a static frame, or none. Default none. */
  startup?: "animate" | "static" | "off";
  /** Old name: false is startup "off". */
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
  // The completions for what is typed; `moved` says the person walked them with the arrows since they last changed.
  type Menu = { items: string[]; word: string; at: number; moved: boolean };
  const closed: Menu = { items: [], word: "", at: 0, moved: false };
  const [menu, setMenuState] = useState<Menu>(closed);
  const menuRef = useRef(menu);
  const setMenu = (next: Menu) => {
    menuRef.current = next;
    setMenuState(next);
  };
  const [scroll, setScroll] = useState(0);
  const startupMode = props.splash === false ? "off" : (props.startup ?? "off");
  const [startedAt] = useState(Date.now());
  const [skipped, setSkipped] = useState(false);
  const starting = startupMode === "animate" && !skipped && Date.now() - startedAt < startupMs();
  const startingRef = useRef(starting);
  startingRef.current = starting;
  const [now, setNow] = useState(Date.now());
  const pasting = useRef(false);
  const secretRef = useRef("");
  const lastCtrlC = useRef(0);
  const [hint, setHint] = useState("");
  // The open question's cursor, and the words being typed to go with a yes or a no (null while the field is closed).
  const askRef = useRef<{ id: string; at: number; words: string | null }>({ id: "", at: 0, words: null });
  const whoAsks = (q: PermissionQuestion) => ctrl.drawing?.roles.find((r) => r.id === q.role)?.label ?? q.roleName;

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
  // The header's pose and the indicators move even at rest (idle sways), so the clock always runs.
  const moving = true;
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => setNow(Date.now()), Math.round(1000 / (props.fps ?? 10)));
    return () => clearInterval(t);
  }, [moving, props.fps]);
  useEffect(() => {
    if (!starting) return;
    const t = setTimeout(() => setSkipped(true), Math.max(0, startupMs() - (Date.now() - startedAt)) + 20);
    return () => clearTimeout(t);
  }, [starting]);

  // Completions follow what is typed.
  useEffect(() => {
    let live = true;
    if (!ed.text.startsWith("/")) {
      if (menuRef.current.items.length) setMenu(closed);
      return;
    }
    completions(ed.text, ctrl).then((c) => {
      if (live) setMenu({ ...c, at: 0, moved: false });
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
    // Any key skips the startup, and does nothing else.
    if (startingRef.current) {
      startingRef.current = false;
      setSkipped(true);
      return;
    }
    setHint("");
    // A key being typed for the keychain takes every key, and shows none of them.
    if (ctrl.secret) {
      const s = secretRef.current;
      if (key.kind === "enter") {
        secretRef.current = "";
        ctrl.secret.resolve(s);
      } else if (key.kind === "escape" || (key.kind === "ctrl" && key.letter === "c")) {
        secretRef.current = "";
        ctrl.secret.resolve(null);
      } else if (key.kind === "backspace") secretRef.current = s.slice(0, -1);
      else if (key.kind === "text" || key.kind === "paste") secretRef.current = s + key.text;
      bump();
      return;
    }
    // A question waiting for you takes the keys first; then an open picker.
    if (ctrl.approvals.length) {
      const q = ctrl.approvals[0];
      const a = askRef.current;
      if (a.id !== q.id) Object.assign(a, { id: q.id, at: 0, words: null });
      const choices = approvalChoices(q.question, whoAsks(q.question));
      const take = (i: number, words?: string) => {
        Object.assign(a, { id: "", at: 0, words: null });
        ctrl.answer(choices[i].answer, words);
      };
      if (key.kind === "ctrl" && key.letter === "c") ctrl.interrupt();
      else if (a.words !== null) {
        // The words that go with a yes or a no; an empty no is a plain no.
        if (key.kind === "enter") take(a.at, a.words);
        else if (key.kind === "tab") a.words = null;
        else if (key.kind === "escape") take(choices.length - 1);
        else if (key.kind === "backspace") a.words = a.words.slice(0, -1);
        else if (key.kind === "text" || key.kind === "paste") a.words += key.text.replace(/[\r\n]+/g, " ");
      } else if (key.kind === "escape") take(choices.length - 1);
      else if (key.kind === "up") a.at = Math.max(0, a.at - 1);
      else if (key.kind === "down") a.at = Math.min(choices.length - 1, a.at + 1);
      else if (key.kind === "tab" && choices[a.at].words) a.words = "";
      else if (key.kind === "shift-tab" && choices.some((c) => c.answer === "session" && q.question.tool === "Write")) take(choices.findIndex((c) => c.answer === "session"));
      // Numbers and Enter answer, never letters: a word typed for the input must not answer a question that just opened.
      else if (key.kind === "enter" || (key.kind === "text" && /^[1-9]$/.test(key.text))) {
        const i = key.kind === "enter" ? a.at : Number(key.text) - 1;
        // No opens the field for what to do instead; Enter on an empty field is a plain no.
        if (i < choices.length) {
          if (choices[i].answer === "deny") Object.assign(a, { at: i, words: "" });
          else take(i);
        }
      }
      bump();
      return;
    }
    if (ctrl.picker) {
      ctrl.pickerKey(key);
      bump();
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
      } else setMenu({ ...m, at: (m.at + (key.kind === "down" ? 1 : m.items.length - 1)) % m.items.length, moved: true });
      return;
    }
    // Enter with the completions open, as Claude Code does: a pick walked to with the arrows is taken; at the
    // command level an unfinished name takes its first match, an exact one runs as typed; an argument runs as typed.
    if (m.items.length && key.kind === "enter" && !e.text.includes("\n")) {
      const argument = /\s/.test(e.text.trimStart());
      const exact = !argument && commandNamed(e.text.trim().slice(1)) !== undefined;
      const pick = m.moved || (!argument && !exact) ? m.items[m.at] : null;
      const line = pick ? `${e.text.slice(0, e.text.length - m.word.length)}${pick}` : e.text;
      setMenu(closed);
      const r = edit({ ...e, text: line, cursor: line.length }, { kind: "enter" });
      setEd(r.state);
      if (r.submitted !== undefined) submit(r.submitted);
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
        if (m.items.length) setMenu(closed);
        else if (!ctrl.interrupt() && e.text) setEd({ ...e, text: "", cursor: 0 });
        return;
      case "pageup":
        setScroll((n) => n + Math.max(1, Math.floor(rows / 2)));
        return;
      case "pagedown":
        setScroll((n) => Math.max(0, n - Math.max(1, Math.floor(rows / 2))));
        return;
      case "shift-tab":
        ctrl.cycleMode();
        return;
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
  const spin = workingSpin(now - ctrl.activitySince, ascii);

  const coreFooter = drawing
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
  // The first line says the engine's state with its indicator; a replay keeps the line that says where it is.
  const footerLines = coreFooter.length === 2 && !replay ? [footerHead(ctrl, drawing, state, now, ascii), coreFooter[1]] : coreFooter;
  const approval = ctrl.approvals[0];
  if (approval && askRef.current.id !== approval.id) Object.assign(askRef.current, { id: approval.id, at: 0, words: null });
  const askLines: Line[] = approval
    ? approvalLines(approval.question, { who: whoAsks(approval.question), workingDir: ctrl.workingDir, at: askRef.current.at, words: askRef.current.words, maxDiff: Math.max(3, Math.min(16, height - 18)), ascii })
    : [];
  // A question waiting for you hides an open picker until it is answered.
  const pickLines: Line[] = ctrl.picker && !approval ? pickerLines(ctrl.picker, { maxRows: Math.max(3, Math.min(12, height - 20)), width, ascii }) : [];
  const secretLines: Line[] = ctrl.secret
    ? [
        [["  ‖ ", "you"], [ctrl.secret.label, "you"]],
        [["    ", ""], ["•".repeat(Math.min(secretRef.current.length, width - 8)) || " ", "b"], ["  Enter keeps it in the keychain · Esc cancels", "faint"]],
      ]
    : [];
  const placeholder = ctrl.running ? "type to steer the run, esc stops it" : replay ? "space pauses, → steps, esc closes the replay" : "a task for the topology, or /help";
  const inLines = inputLines(ed, width, ascii, plain, hint || placeholder).slice(-MAX_INPUT_LINES);
  const menuLines: Line[] = menu.items.slice(0, MAX_MENU).map((item, i): Line => [[i === menu.at ? "  ▸ " : "    ", i === menu.at ? "b" : "faint"], [item, i === menu.at ? "b" : "dim"]]);
  const rule: Line = [["─".repeat(width), "faint"]];
  // The startup plays alone, full screen and centred, before the session is drawn.
  if (starting) {
    const { rows: art } = startupRows(now - startedAt, ascii);
    const text: Line[] = [[], [], [], [[theme.name.toLowerCase(), "b"]], [[theme.tagline, "dim"]], [[version, "faint"]]];
    const textWidth = Math.max(...text.map((l) => l.reduce((n, [t]) => n + [...t].length, 0)));
    const left = " ".repeat(Math.max(0, Math.floor((width - theme.startup.cols - 2 - textWidth) / 2)));
    const top = Math.max(0, Math.floor((height - art.length) / 2));
    const centred: Line[] = [...Array.from({ length: top }, (): Line => []), ...art.map((a, i): Line => [[left, ""], ...a, ["  ", ""], ...(text[i] ?? [])])];
    while (centred.length < height) centred.push([]);
    return (
      <Box flexDirection="column" width={width} height={height}>
        <StyledLines lines={centred.slice(0, height)} plain={plain} ascii={ascii} width={width} />
      </Box>
    );
  }

  // One Jig on screen at a time: the large logo at rest until the first task, whole or not at all; then the
  // header's medium form, in the pose of the engine's state. A resumed session opens on the header.
  const regions = (withHeader: boolean) => {
    const head = withHeader && height >= 20 ? headerLines(ctrl, version, now, ascii, width) : [];
    const fixed = head.length + footerLines.length + inLines.length + 1 + menuLines.length + askLines.length + pickLines.length + secretLines.length;
    const room = Math.max(3, height - fixed);
    const gridRoom = Math.max(1, Math.floor(room / 2));
    const block = drawing ? drawingBlock(drawing, state, { width, maxRows: gridRoom, layout: ctrl.folded ? "strip" : "auto", spin }) : null;
    const gLines = block ? gridLines(block.grid).slice(0, gridRoom) : [];
    return { head, gLines, convRoom: Math.max(1, room - gLines.length - (gLines.length ? 1 : 0)) };
  };
  const hasTask = ctrl.messages.some((m) => m.kind === "you" || m.kind === "run");
  const rest = conversationLines(ctrl, width, now, ascii, { plain, previewRows: height >= 40 ? 6 : height >= 30 ? 5 : 4 });
  const welcome = hasTask ? [] : welcomeLines(ctrl, version, ascii, Boolean(props.resumed));
  let layout = regions(false);
  let convLines: Line[];
  if (welcome.length && welcome.length + (rest.length ? 1 : 0) + rest.length <= layout.convRoom) convLines = [...welcome, ...(rest.length ? [[] as Line] : []), ...rest];
  else {
    layout = regions(true);
    convLines = rest;
  }
  const { head: header, gLines, convRoom } = layout;
  const maxScroll = Math.max(0, convLines.length - convRoom);
  const off = Math.min(scroll, maxScroll);
  const shown = convLines.slice(Math.max(0, convLines.length - convRoom - off), convLines.length - off);
  if (off > 0 && shown.length) shown[shown.length - 1] = [[`  ↓ ${off} more line${off > 1 ? "s" : ""} below · PgDn`, "b"]];
  while (shown.length < convRoom) shown.push([]);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <StyledLines lines={header} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={gLines} plain={plain} ascii={ascii} width={width} />
      {gLines.length ? <StyledLines lines={[rule]} plain={plain} ascii={ascii} width={width} /> : null}
      <StyledLines lines={shown} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={askLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={pickLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={secretLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={[rule]} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={inLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={menuLines} plain={plain} ascii={ascii} width={width} />
      <StyledLines lines={footerLines} plain={plain} ascii={ascii} width={width} />
    </Box>
  );
}
