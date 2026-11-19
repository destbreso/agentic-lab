#!/usr/bin/env node
// Refuses a terminal recording that shows where it was made. A GIF or WebP of
// a session goes into a public repository, so nothing on its screen may name
// the real home folder, the user, or the temporary folder it was recorded in.
// Run it on every capture (the {t, b64} lines a pty driver writes) and every
// text snapshot before rendering; it exits 1 and names each hit.
//
//   node scripts/check-recording.mjs <capture.jsonl | snapshot.txt>... [--forbid <text>]...
//
// Record in a neutral place instead: env -i HOME=<a scratch folder>, the
// session in $HOME/code/<a made-up project>, so the header reads ~/code/....

import { readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";

const args = process.argv.slice(2);
const files = [];
const forbid = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--forbid") forbid.add(args[++i]);
  else files.push(args[i]);
}
if (!files.length) {
  console.error("usage: check-recording.mjs <capture.jsonl | snapshot.txt>... [--forbid <text>]...");
  process.exit(2);
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
// The places a recording must never show: this machine's home and user, and its temporary folders.
for (const p of [homedir(), real(homedir()), tmpdir(), real(tmpdir()), "/private/tmp/", "/private/var/folders/"]) if (p && p.length > 4) forbid.add(p);
const user = userInfo().username;
if (user && user.length >= 3) forbid.add(user);

/** The text a file shows: a capture's bytes decoded, or the file as it is. */
const shown = (file) => {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const capture = lines.length > 0 && lines.every((l) => l.startsWith("{") && l.includes('"b64"'));
  if (!capture) return text;
  return lines.map((l) => Buffer.from(JSON.parse(l).b64, "base64").toString("utf-8")).join("");
};

let hits = 0;
for (const file of files) {
  // Escape codes are taken out, so a path split by a colour change is still found.
  const text = shown(file).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  for (const f of forbid) {
    const at = text.indexOf(f);
    if (at < 0) continue;
    hits++;
    console.error(`${file}: shows "${f}": …${text.slice(Math.max(0, at - 30), at + f.length + 30).replace(/\s+/g, " ")}…`);
  }
}
if (hits) {
  console.error(`refused: ${hits} trace${hits > 1 ? "s" : ""} of where this was recorded. Record it again in a neutral place.`);
  process.exit(1);
}
console.log(`clean: ${files.length} file${files.length > 1 ? "s" : ""}, nothing of this machine's home, user or temporary folders`);
