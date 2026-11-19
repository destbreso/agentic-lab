// Every glyph the grid, the footer, the indicators, the topologies and the
// session can draw is one cell wide in every terminal: never wide in today's
// Unicode tables (☰, wide since Unicode 16, pushed the Plan box's border one
// column out), and never ambiguous except the box lines and the art, which a
// terminal that widens ambiguous characters gets in ASCII (the probe, checked
// here against a fake terminal).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { eastAsianWidth } from "get-east-asian-width";
import { listRecipes, type Topology } from "jig-core";
import { toAscii } from "./ascii.js";
import { ambiguousIsWide } from "../terminal-width.js";

const packages = join(import.meta.dirname, "..", "..", "..");
const sources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (!f.startsWith("__") && f !== "node_modules") walk(p);
      } else if (/\.(ts|tsx|json|yaml)$/.test(f) && !f.includes(".test.") && f !== "ascii.ts") out.push(p);
    }
  };
  walk(join(packages, "core", "src", "grid"));
  walk(join(packages, "cli", "src", "session"));
  // ascii.ts is the table of twins: its keys are what it reads, not what Jig draws. play and replay draw the live view.
  out.push(join(packages, "cli", "src", "commands", "play.ts"), join(packages, "cli", "src", "commands", "replay.ts"), join(packages, "core", "src", "formats", "model.ts"), join(packages, "cli", "src", "live-view.ts"), join(packages, "cli", "src", "session-runner.ts"));
  return out;
};

/** What a built-in topology puts on screen: its name, each role's face, and the labels of its edges. */
const drawnText = (): Array<[string, string]> =>
  listRecipes().map((t) => {
    const top = t as Topology;
    const parts = [
      top.name,
      ...Object.values(top.faces ?? {}).flatMap((f) => [f.label, f.icon]),
      ...(top.consults ?? []).flatMap((c) => [c.label, c.role.face.label, c.role.face.icon]),
      ...(top.waysBack ?? []).map((w) => w.label),
      ...(top.exit?.when ?? []),
    ];
    return [parts.filter(Boolean).join(" "), `topology ${t.id}`];
  });

describe("the glyphs Jig draws", () => {
  const glyphs = new Map<string, string>();
  const texts: Array<[string, string]> = [...sources().map((file): [string, string] => [readFileSync(file, "utf-8"), file.slice(packages.length + 1)]), ...drawnText()];
  for (const [text, where] of texts) {
    for (const ch of text) {
      if (ch.codePointAt(0)! > 127 && !glyphs.has(ch)) glyphs.set(ch, where);
    }
  }

  it("finds the glyphs to check", () => {
    expect(glyphs.size).toBeGreaterThan(50);
  });

  it("never draws a glyph two cells wide in today's Unicode tables, or one shown as emoji", () => {
    const wide = [...glyphs].filter(([ch]) => eastAsianWidth(ch.codePointAt(0)!) !== 1 || /\p{Emoji_Presentation}/u.test(ch));
    expect(wide.map(([ch, file]) => `${ch} U+${ch.codePointAt(0)!.toString(16)} in ${file}`)).toEqual([]);
  });

  it("draws nothing ambiguous in width but the box lines and the art, which the probe covers", () => {
    const boxLine = (cp: number) => cp >= 0x2500 && cp <= 0x257f;
    const stray = [...glyphs].filter(([ch, file]) => eastAsianWidth(ch.codePointAt(0)!, { ambiguousAsWide: true }) !== 1 && !boxLine(ch.codePointAt(0)!) && !file.endsWith("jig-theme.json"));
    expect(stray.map(([ch, file]) => `${ch} U+${ch.codePointAt(0)!.toString(16)} in ${file}`)).toEqual([]);
  });

  it("has an ASCII twin for every glyph ambiguous in width, for a terminal that draws those two cells wide", () => {
    const ambiguous = [...glyphs].filter(([ch]) => eastAsianWidth(ch.codePointAt(0)!, { ambiguousAsWide: true }) !== 1);
    expect(ambiguous.length).toBeGreaterThan(10);
    expect(ambiguous.filter(([ch]) => toAscii(ch) === "?").map(([ch, file]) => `${ch} in ${file}`)).toEqual([]);
  });
});

describe("the probe for ambiguous width", () => {
  // A fake terminal: answers the cursor position request with the column the probe would reach.
  const terminal = (column: number | null) => {
    const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(this: { isRaw: boolean }, v: boolean) { this.isRaw = v; return this; } }) as unknown as NodeJS.ReadStream;
    const written: string[] = [];
    const output = Object.assign(new PassThrough(), { isTTY: true }) as unknown as NodeJS.WriteStream;
    output.write = ((chunk: string) => {
      written.push(chunk);
      if (chunk.includes("\x1b[6n") && column !== null) setTimeout(() => (input as unknown as PassThrough).write(`\x1b[12;${column}R`), 5);
      return true;
    }) as typeof output.write;
    return { input, output, written };
  };

  it("says wide when the box line or the art's circle took two cells, narrow when each took one, and nothing when the terminal does not answer", async () => {
    expect(await ambiguousIsWide(terminal(5), 200)).toBe(true);
    // A terminal that keeps box lines narrow but widens the rest of the ambiguous characters.
    expect(await ambiguousIsWide(terminal(4), 200)).toBe(true);
    expect(await ambiguousIsWide(terminal(3), 200)).toBe(false);
    expect(await ambiguousIsWide(terminal(null), 50)).toBeNull();
    const t = terminal(3);
    await ambiguousIsWide(t, 200);
    // It cleans the line it wrote on, and gives raw mode back.
    expect(t.written.at(-1)).toBe("\r\x1b[2K");
    expect((t.input as unknown as { isRaw: boolean }).isRaw).toBe(false);
  });

  it("does not ask off a terminal", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: false }) as unknown as NodeJS.ReadStream;
    const output = Object.assign(new PassThrough(), { isTTY: false }) as unknown as NodeJS.WriteStream;
    expect(await ambiguousIsWide({ input, output }, 50)).toBeNull();
  });
});
