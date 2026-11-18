// The chat's recall stays within its scope: this conversation by default, so
// a task from another conversation cannot reach the run (phase 0 saw it happen).

import { describe, it, expect } from "vitest";
import { InMemoryStorage, taskKey } from "jig-core";
import { composeRequest, memoryNamespace, recallMemories } from "./agent-run";

async function storage() {
  const s = new InMemoryStorage();
  await s.memory.put(["chat", "s1"], "a", { text: "MARK-S1 swap the probe", role: "user" });
  await s.memory.put(["chat", "s2"], "b", { text: "MARK-S2 swap the probe", role: "user" });
  await s.memory.put(["task", taskKey("swap the probe")], "c", { text: "MARK-TASK swap the probe", role: "agent" });
  await s.memory.put(["memory-bank", "facts"], "d", { text: "MARK-BANK swap the probe", role: "user" });
  return s;
}

const marks = (memories: string[]) => memories.map((m) => m.match(/MARK-\w+/)![0]).sort();

describe("chat memory scope", () => {
  it("recalls from this conversation only, by default", async () => {
    const r = await recallMemories(await storage(), "swap the probe", { sessionId: "s2" });
    expect(marks(r.memories)).toEqual(["MARK-S2"]);
    expect(r.namespace).toEqual(["chat", "s2"]);
  });

  it("recalls runs of the same task, every conversation, or nothing, when asked", async () => {
    const s = await storage();
    expect(marks((await recallMemories(s, "swap the probe", { scope: "task" })).memories)).toEqual(["MARK-TASK"]);
    expect(marks((await recallMemories(s, "swap the probe", { scope: "shared" })).memories)).toEqual(["MARK-S1", "MARK-S2"]);
    expect((await recallMemories(s, "swap the probe", { scope: "off", sessionId: "s1" })).memories).toEqual([]);
    expect((await recallMemories(s, "swap the probe", { scope: "session" })).memories).toEqual([]);
  });

  it("reads a bank only when one is named", async () => {
    const s = await storage();
    expect(marks((await recallMemories(s, "swap the probe", { bank: "facts", scope: "off" })).memories)).toEqual(["MARK-BANK"]);
    expect(memoryNamespace("t", { scope: "off" })).toBeNull();
  });

  it("keeps recalled memories apart from the task, marked as written", () => {
    const req = composeRequest({ task: "swap", memories: ["[user]: old"], context: [{ role: "user", content: "hi" }] });
    expect(req.task).toBe("swap");
    expect(req.inputs?.map((i) => [i.name, i.provenance])).toEqual([
      ["conversation", "written"],
      ["memories", "written"],
    ]);
  });
});
