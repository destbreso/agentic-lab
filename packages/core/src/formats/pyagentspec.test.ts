// Oracle's own reader, when it is installed: pyagentspec 26.3.1 must read
// every built-in file, compact as it is written, exactly as the full form.
// JIG_PYAGENTSPEC names a Python with pyagentspec; without it the
// test is skipped.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBuiltinTopologies } from "./builtin.js";
import { coreFile } from "./files.js";
import { writeTopologyText } from "./index.js";

const python = process.env.JIG_PYAGENTSPEC;

describe.skipIf(!python)("pyagentspec reads the built-in files", () => {
  it("reads each compact file as the full one", () => {
    const dir = mkdtempSync(join(tmpdir(), "pyagentspec-"));
    try {
      for (const form of ["compact", "expanded"] as const) {
        for (const t of loadBuiltinTopologies()) {
          const sub = join(dir, form);
          mkdirSync(sub, { recursive: true });
          writeFileSync(join(sub, `${t.id}.yaml`), writeTopologyText(t, { form }).text);
        }
      }
      const r = spawnSync(python!, ["-I", coreFile("scripts", "pyagentspec-check.py"), join(dir, "compact"), join(dir, "expanded")], { encoding: "utf-8" });
      expect(r.stderr).toBe("");
      const lines = r.stdout.trim().split("\n");
      expect(lines).toHaveLength(loadBuiltinTopologies().length);
      for (const line of lines) expect(line).toMatch(/ same$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
