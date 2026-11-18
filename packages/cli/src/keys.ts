// ============================================
// Keys from a terminal, one at a time
// ============================================
// show --play and replay read single keys: stdin in raw mode, given back as
// it was when they stop. In raw mode Ctrl+C is a key, not a signal, so it is
// reported as "ctrl-c" and the caller decides.

export type Key = "space" | "right" | "left" | "up" | "down" | "pageup" | "pagedown" | "home" | "end" | "enter" | "escape" | "ctrl-c" | string;

export interface KeyReader {
  stop(): void;
}

const NAMES: Record<string, Key> = {
  " ": "space",
  "\r": "enter",
  "\n": "enter",
  "\x1b": "escape",
  "\x03": "ctrl-c",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[5~": "pageup",
  "\x1b[6~": "pagedown",
  "\x1b[H": "home",
  "\x1b[1~": "home",
  "\x1bOH": "home",
  "\x1b[F": "end",
  "\x1b[4~": "end",
  "\x1bOF": "end",
};

/** The keys that scroll a view's log, and what they do to it. */
export function scrollKey(key: Key, view: { scroll(n: number): void; page(d: 1 | -1): void; follow(): void; top(): void }): boolean {
  if (key === "up") view.scroll(1);
  else if (key === "down") view.scroll(-1);
  else if (key === "pageup") view.page(1);
  else if (key === "pagedown") view.page(-1);
  else if (key === "end") view.follow();
  else if (key === "home") view.top();
  else return false;
  return true;
}

/** Call `onKey` for each key pressed, when stdin is a terminal; a no-op otherwise. */
export function readKeys(onKey: (key: Key) => void, stdin: NodeJS.ReadStream = process.stdin): KeyReader {
  if (!stdin.isTTY) return { stop: () => {} };
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  const onData = (data: Buffer) => {
    const text = data.toString("utf-8");
    onKey(NAMES[text] ?? text);
  };
  stdin.on("data", onData);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stdin.off("data", onData);
    stdin.setRawMode(wasRaw);
    stdin.pause();
  };
  process.once("exit", stop);
  return { stop };
}
