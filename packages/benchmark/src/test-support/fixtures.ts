// A spec and a task set written to a scratch folder, and a scripted model that does the work.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { scriptedProvider, untilAborted, type ScriptedProvider } from "../../../core/src/test-support/scripted-provider.js";

export interface Scratch {
  dir: string;
  spec: string;
  out: string;
  writeSpec(spec: Record<string, unknown>): Promise<void>;
  writeTasks(set: Record<string, unknown>): Promise<void>;
  remove(): Promise<void>;
}

export async function scratch(): Promise<Scratch> {
  const dir = await mkdtemp(join(tmpdir(), "jig-benchmark-test-"));
  return {
    dir,
    spec: join(dir, "spec.yaml"),
    out: join(dir, "out"),
    writeSpec: (spec) => writeFile(join(dir, "spec.yaml"), stringify(spec)),
    writeTasks: (set) => writeFile(join(dir, "tasks.yaml"), stringify(set)),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Two tasks: one the direct arm applies to (a file named hello.txt holding hi), one it does not. */
export const helloTasks = {
  name: "hello",
  description: "Write a file.",
  tasks: [
    { id: "hello", task: "Write hello.txt containing hi", checks: ["grep -qx hi hello.txt"], direct: { file: "hello.txt" }, tags: ["files"] },
    { id: "bye", task: "Write bye.txt containing bye", checks: [{ name: "the file", command: "grep -qx bye bye.txt" }], tags: ["files"] },
  ],
};

export const helloSpec = (extra: Record<string, unknown> = {}) => ({
  name: "hello-test",
  question: "Does Execute & Evaluate write the file more often?",
  tasks: "tasks.yaml",
  arms: ["exec-eval"],
  model: "scripted/scripted",
  repetitions: 1,
  budget: { tokens: 10000 },
  ...extra,
});

/**
 * Do writes what its task asks for, through its tool, then says it is done; asked with no system prompt (the
 * direct arm), it answers with a code block holding hi. Turns are read from the messages, not counted, because one
 * provider serves every attempt.
 */
export function workingModel(): ScriptedProvider {
  return scriptedProvider((c) => {
    if (c.role === "do") {
      if (c.options.messages.some((m) => m.role === "tool")) return "done";
      const [file, content] = c.prompt.includes("bye.txt") ? ["bye.txt", "bye\n"] : ["hello.txt", "hi\n"];
      return { toolCalls: [{ name: "file_write", arguments: { path: file, content } }] };
    }
    if (c.role === "other" && !c.system) return "Here it is:\n```\nhi\n```";
    return undefined;
  });
}

export { scriptedProvider, untilAborted };
