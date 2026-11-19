// The live view in a real pseudo-terminal. The CLI runs under script(1),
// against a mock Ollama whose first call takes seconds, and the bytes the
// terminal receives are kept with their times: while that call is pending the
// frames keep coming and keep changing (the spinner, the clock), the screen
// is the alternate one, and the terminal gets its cursor and its screen back
// when the run ends, and when it is stopped with Ctrl+C.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { slowOllama, type SlowOllama } from "./test-support/slow-ollama.js";

const hasScript = (process.platform === "darwin" || process.platform === "linux") && spawnSync("sh", ["-c", "command -v script"]).status === 0;
const cliRoot = resolve(__dirname, "..");
const viteNode = resolve(cliRoot, "../../node_modules/.bin/vite-node");

interface Captured {
  chunks: Array<{ t: number; text: string }>;
  code: number | null;
}

const cli = (args: string[]) => [viteNode, resolve(cliRoot, "src/index.ts"), ...args];
const baseEnv = () => ({ PATH: process.env.PATH!, HOME: process.env.HOME!, TERM: "xterm-256color" });

/** Run the CLI under script(1): a pseudo-terminal with no size set, nothing typed into it. */
function underScript(args: string[], env: Record<string, string>): Promise<Captured> {
  const cmd = cli(args).map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const argv = process.platform === "darwin" ? ["-q", "/dev/null", "sh", "-c", cmd] : ["-qfec", cmd, "/dev/null"];
  // macOS's script refuses a socket (or a FIFO) for stdin, so it reads /dev/null.
  const child = spawn("script", argv, { cwd: cliRoot, env: { ...baseEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Captured["chunks"] = [];
  const decoder = new StringDecoder("utf-8");
  child.stdout!.on("data", (b: Buffer) => chunks.push({ t: Date.now(), text: decoder.write(b) }));
  return new Promise((done) => child.on("close", (code) => done({ chunks, code })));
}

const driver = resolve(cliRoot, "src/test-support/pty-driver.py");
const hasPython = spawnSync("python3", ["-c", "import pty"]).status === 0;

/** Run the CLI in a pseudo-terminal of a given size, through Python's pty module, so a test can type into it. */
function inPty(
  cols: number,
  rows: number,
  args: string[],
  env: Record<string, string>,
  then?: (type: (s: string) => void, resize: (cols: number, rows: number) => void) => void,
): Promise<Captured> {
  const child = spawn("python3", ["-I", driver, String(cols), String(rows), ...cli(args)], { cwd: cliRoot, env: { ...baseEnv(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Captured["chunks"] = [];
  const decoder = new StringDecoder("utf-8");
  let rest = "";
  child.stdout.on("data", (b: Buffer) => {
    const lines = (rest + b.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) chunks.push({ t: JSON.parse(l).t, text: decoder.write(Buffer.from(JSON.parse(l).b64, "base64")) });
  });
  then?.((s) => child.stdin.write(`${JSON.stringify(s)}\n`), (cols, rows) => child.stdin.write(`${JSON.stringify({ resize: [cols, rows] })}\n`));
  return new Promise((done) => child.on("close", (code) => done({ chunks, code })));
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
/** The frames drawn in place, each with the time it arrived. */
function frames(c: Captured): Array<{ t: number; text: string }> {
  const out: Array<{ t: number; text: string }> = [];
  let buf = "";
  for (const ch of c.chunks) {
    buf += ch.text;
    let i: number;
    while ((i = buf.indexOf("\x1b[?2026l")) >= 0) {
      const start = buf.lastIndexOf("\x1b[?2026h", i);
      if (start >= 0) out.push({ t: ch.t, text: strip(buf.slice(start, i)) });
      buf = buf.slice(i + 8);
    }
  }
  return out;
}

let dir: string;
let ollama: SlowOllama;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-pty-"));
});
afterAll(async () => {
  await ollama?.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!hasScript)("the live view in a real terminal", () => {
  it("keeps moving while a model call is pending, and gives the terminal back at the end", async () => {
    ollama = await slowOllama((n) => (n === 1 ? 3000 : 30));
    const c = await underScript(["run", "--topology", "exec-eval", "--task", "say hello", "--provider", "ollama", "--model", "slow-mock", "--dir", dir, "--live", "--width", "100", "--delay", "0", "--check", "true"], { OLLAMA_BASE_URL: ollama.url });
    const all = c.chunks.map((x) => x.text).join("");
    expect(c.code).toBe(0);
    // The alternate screen and a hidden cursor while it runs; both given back after, then the last frame stays.
    expect(all.indexOf("\x1b[?1049h")).toBeGreaterThanOrEqual(0);
    const leave = all.lastIndexOf("\x1b[?25h\x1b[?1049l");
    expect(leave).toBeGreaterThan(all.indexOf("\x1b[?1049h"));
    expect(strip(all.slice(leave))).toMatch(/✓ passed/);

    // While Do's first call is pending, frames keep arriving and they change: the spinner turns and the clock runs.
    const first = ollama.calls[0];
    expect(first.answered - first.arrived).toBeGreaterThanOrEqual(2900);
    const pending = frames(c).filter((f) => f.t > first.arrived + 200 && f.t < first.answered - 100);
    expect(pending.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pending.map((f) => f.text)).size).toBeGreaterThanOrEqual(5);
    const spinners = new Set(pending.map((f) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] (working|▱)/.exec(f.text)?.[0]).filter(Boolean));
    expect(spinners.size).toBeGreaterThanOrEqual(3);
    const clocks = new Set(pending.map((f) => / (\d\d:\d\d)$/m.exec(f.text)?.[1]).filter(Boolean));
    expect(clocks.size).toBeGreaterThanOrEqual(2);
    // Every frame overwrites the last from the top, line by line: no full clear, so no flicker.
    expect(all).not.toContain("\x1b[2J");
  }, 60_000);

  it.skipIf(!hasPython)("fits the terminal's size, and gives the terminal back when Ctrl+C stops the run", async () => {
    await ollama?.close();
    ollama = await slowOllama(() => 20_000);
    const c = await inPty(90, 28, ["run", "--topology", "deep-reasoning", "--task", "say hello", "--provider", "ollama", "--model", "slow-mock", "--dir", dir, "--live"], { OLLAMA_BASE_URL: ollama.url }, (type) => {
      // Ctrl+C, typed, once the first call is pending.
      const wait = setInterval(() => {
        if (ollama.calls.length > 0) {
          clearInterval(wait);
          setTimeout(() => type("\x03"), 1000);
        }
      }, 50);
    });
    const all = c.chunks.map((x) => x.text).join("");
    expect(c.code).toBe(130);
    expect(all).toContain("\x1b[?1049h");
    const leave = all.lastIndexOf("\x1b[?25h\x1b[?1049l");
    expect(leave).toBeGreaterThan(0);
    expect(strip(all.slice(leave))).toMatch(/stopped/);
    // Every frame fills the terminal and no more: 90 columns, its 28 rows.
    const drawn = frames(c);
    expect(drawn.length).toBeGreaterThan(3);
    for (const f of drawn) {
      const lines = f.text.split(/\r*\n/);
      expect(lines.length).toBe(28);
      for (const l of lines) expect([...l].length, JSON.stringify(l)).toBeLessThanOrEqual(90);
    }
    // The call in flight was aborted: Ollama saw it go away long before its 20 seconds.
    expect(ollama.calls[0].answered).toBe(0);
  }, 60_000);

  const rowsOf = (f: { text: string }) => f.text.split(/\r*\n/);
  /** The rows above the log's border: the drawing, which the log must never move. */
  const drawingRows = (f: { text: string }) => {
    const rows = rowsOf(f);
    const border = rows.findIndex((l) => l.includes("── log"));
    return border < 0 ? rows : rows.slice(0, border);
  };
  /** A frame with the time and the spinner made constant, for a snapshot. */
  const steady = (f: { text: string }) => rowsOf(f).map((l) => l.replace(/\d\d:\d\d/g, "mm:ss").replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "⠿").trimEnd()).join("\n");

  it.skipIf(!hasPython)("fills the terminal at 150x47, 120x30, 80x24 and 80x12, the log only in the rows left", async () => {
    const out: string[] = [];
    for (const id of ["deep-reasoning", "advisor"]) {
      for (const [w, h] of [[150, 47], [120, 30], [80, 24], [80, 12]]) {
        const c = await inPty(w, h, ["show", id, "--play", "--once", "--speed", "25"], {});
        expect(c.code, `${id} ${w}x${h}`).toBe(0);
        const drawn = frames(c);
        for (const f of drawn) {
          expect(rowsOf(f), `${id} ${w}x${h}`).toHaveLength(h);
          for (const l of rowsOf(f)) expect([...l].length, `${id} ${w}x${h}: ${l}`).toBeLessThanOrEqual(w);
        }
        // The last frame before the terminal is given back.
        out.push(`## ${id}, ${w}x${h}\n\n${steady(drawn.at(-1)!)}\n`);
      }
    }
    await expect(out.join("\n")).toMatchFileSnapshot("./__pty__/sizes.txt");
  }, 120_000);

  it.skipIf(!hasPython)("follows a resize in the middle of a run", async () => {
    let resizedAt = 0;
    const c = await inPty(150, 47, ["show", "deep-reasoning", "--play", "--once", "--speed", "2"], {}, (_type, resize) => {
      setTimeout(() => {
        resizedAt = Date.now();
        resize(80, 24);
      }, 2500);
    });
    expect(c.code).toBe(0);
    const drawn = frames(c);
    const before = drawn.filter((f) => f.t < resizedAt);
    const after = drawn.filter((f) => f.t > resizedAt + 300);
    expect(before.length).toBeGreaterThan(5);
    expect(after.length).toBeGreaterThan(5);
    for (const f of before) expect(rowsOf(f)).toHaveLength(47);
    for (const f of after) {
      expect(rowsOf(f)).toHaveLength(24);
      for (const l of rowsOf(f)) expect([...l].length).toBeLessThanOrEqual(80);
    }
  }, 60_000);

  it.skipIf(!hasPython)("scrolls the log back without moving the drawing, paused or running, and follows again on End", async () => {
    const marks: Record<string, number> = {};
    const mark = (name: string, type: (s: string) => void, key: string) => {
      marks[name] = Date.now();
      type(key);
    };
    const c = await inPty(150, 24, ["show", "deep-reasoning", "--play", "--speed", "1"], {}, (type) => {
      const steps: Array<[number, string, string]> = [
        [4000, "pause", " "],
        [4300, "up1", "\x1b[A"],
        [4600, "up2", "\x1b[A"],
        [4900, "pageup", "\x1b[5~"],
        [5200, "home", "\x1b[H"],
        [5600, "resume", " "],
        [6000, "back", "\x1b[5~"],
        [8500, "end", "\x1b[F"],
        [9500, "quit", "q"],
      ];
      for (const [ms, name, key] of steps) setTimeout(() => mark(name, type, key), ms);
    });
    expect(c.code).toBe(0);
    const drawn = frames(c);
    // Paused, every scroll redraws the log and nothing else: the drawing's rows are the same in every frame.
    const scrolling = drawn.filter((f) => f.t > marks.pause + 100 && f.t < marks.resume);
    expect(scrolling.length).toBeGreaterThanOrEqual(4);
    const first = drawingRows(scrolling[0]);
    for (const f of scrolling) expect(drawingRows(f)).toEqual(first);
    const logs = new Set(scrolling.map((f) => rowsOf(f).slice(first.length).join("\n")));
    expect(logs.size).toBeGreaterThanOrEqual(3);
    expect(scrolling.at(-1)!.text).toMatch(/── log ∙ lines 1 to \d+ of \d+ ∙ \d+ new below/);
    // Running and scrolled back, new lines wait below and are counted; the drawing goes on updating above.
    const back = drawn.filter((f) => f.t > marks.back + 300 && f.t < marks.end);
    const counts = back.map((f) => Number(/(\d+) new below/.exec(f.text)?.[1] ?? -1)).filter((n) => n >= 0);
    expect(counts.length).toBeGreaterThan(3);
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts));
    // End follows the newest again.
    const following = drawn.filter((f) => f.t >= marks.end && f.t < marks.quit);
    expect(following.length).toBeGreaterThan(0);
    expect(following.at(-1)!.text).not.toContain("new below");
  }, 60_000);
});
