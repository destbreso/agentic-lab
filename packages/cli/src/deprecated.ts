#!/usr/bin/env node
// The command's names before the rename (agentic-lab, alab): they still work,
// and say so on stderr, so a script's stdout (--json) stays as it was.

import { basename } from "node:path";

const called = basename(process.argv[1] ?? "").replace(/\.js$/, "");
const name = called === "alab" ? "alab" : "agentic-lab";
process.stderr.write(`${name} is now jig. This name still works for a while and then goes: run jig instead.\n`);
await import("./index.js");
