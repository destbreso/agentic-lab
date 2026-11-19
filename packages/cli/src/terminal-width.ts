// ============================================
// Whether the terminal draws ambiguous characters two cells wide
// ============================================
// Every glyph Jig draws is one cell wide in every terminal, except two kinds
// Unicode leaves "ambiguous": the box-drawing lines the boxes are made of, and
// the block and circle cells of Jig's art. Both are one cell in every
// terminal's default and two where a terminal is set to draw ambiguous
// characters wide (a common setting with CJK fonts; some terminals widen one
// kind and not the other). Nothing else can draw a box, so Jig asks the
// terminal: it prints one of each at the start of a line and asks where the
// cursor ended (a cursor position report). More than two cells means the
// session and the live view draw in ASCII, where every character is one cell
// by construction. No answer in time means one cell each.

/** The probe: a box-drawing line and a circle of the art, one cell each in a terminal that draws them narrow. */
const PROBE = "─●";

export interface ProbeStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

/** True when the terminal draws ambiguous characters two cells wide; false when one; null when it did not say. */
export async function ambiguousIsWide({ input, output }: ProbeStreams = { input: process.stdin, output: process.stdout }, timeoutMs = 250): Promise<boolean | null> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return null;
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve) => {
    let reply = "";
    const finish = (value: boolean | null) => {
      clearTimeout(timer);
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      // The probe leaves nothing behind on the line.
      output.write("\r\x1b[2K");
      resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      reply += chunk.toString();
      const m = /\x1b\[(\d+);(\d+)R/.exec(reply);
      if (m) finish(Number(m[2]) > PROBE.length + 1);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    input.on("data", onData);
    output.write(`\r${PROBE}\x1b[6n`);
  });
}

