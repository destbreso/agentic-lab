// The layout engine, pinned as text: every built-in topology at rest in the
// three layouts, with its measured walls, and in run states scripted from a
// real run of the engine on a scripted model. The run-state snapshots carry a
// second layer that marks the cells drawn in a run's colours (r running,
// p passed, f failed, y waiting for you), so a change of colour shows too.

import { describe, it, expect } from "vitest";
import { AgentSession, type SessionEvent } from "../engine/agent-session.js";
import { measureSight } from "../engine/sight.js";
import { getRecipe } from "../loops/recipes.js";
import { BUILT_IN_TOPOLOGIES } from "../formats/builtin.js";
import { createDefaultToolkit } from "../tools/defaults.js";
import { scriptedProvider } from "../test-support/scripted-provider.js";
import type { Topology } from "../formats/model.js";
import { drawingOf, foldRun, horizontal, horizontalWidth, layoutFor, meaningsOf, strip, toANSI, toText, stripANSI, vertical, type RunState } from "./index.js";

const FAIL = JSON.stringify({ verdict: "fail", evidence: ["the output is wrong"], corrections: ["fix it"], confidence: 0.5 });

/** A run of the topology on a scripted model: Check fails once, then passes; Decide refines once; Do consults once. */
async function scriptedRun(t: Topology): Promise<SessionEvent[]> {
  let checks = 0;
  let decides = 0;
  const provider = scriptedProvider((call) => {
    if (call.system.startsWith("You are an advisor")) return "read the tests first";
    if (call.role === "check") return ++checks === 1 ? FAIL : undefined;
    if (call.role === "decide") return ++decides === 1 ? JSON.stringify({ decision: "refine", reason: "not yet", corrections: ["again"] }) : undefined;
    if (call.role === "do" && call.tools.includes("consult_advisor") && !call.prompt.includes("read the tests first")) {
      return { toolCalls: [{ name: "consult_advisor", arguments: {} }] };
    }
    return undefined;
  });
  const events: SessionEvent[] = [];
  const session = new AgentSession({ provider, tools: createDefaultToolkit(), topology: t, workingDir: "/tmp", delayMs: 0, maxRounds: 3 });
  session.on("event", (e) => events.push(e));
  session.steer("look at the edge case");
  await session.run("the task");
  return events;
}

/** The state after the first event that matches, on a clock that ticks a second an event. */
function stateAt(events: SessionEvent[], until: (e: SessionEvent, i: number) => boolean): RunState {
  const end = events.findIndex(until);
  let t = 0;
  return foldRun(end < 0 ? events : events.slice(0, end + 1), () => (t += 1000));
}

const section = (title: string, body: string) => `## ${title}\n\n${body}\n`;

describe("the layout engine", () => {
  for (const id of BUILT_IN_TOPOLOGIES) {
    it(`draws ${id} at rest and in scripted run states`, async () => {
      const t = getRecipe(id)!;
      const sight = await measureSight(t);
      const d = drawingOf(t, { sight, source: `topologies/${id}.yaml`, model: "qwen2.5:7b" });
      const out: string[] = [
        section("horizontal, at rest, with the measured walls", toText(horizontal(d))),
        section("vertical, at rest, 80 columns", toText(vertical(d, undefined, { width: 80 }))),
        section("strip, at rest", toText(strip(d))),
      ];

      const events = await scriptedRun(t);
      // Mid-run: the second round's second role at work (the first round's, for a one-round topology).
      const rounds = events.filter((e) => e.type === "round:start").length;
      let seen = 0;
      const mid = stateAt(events, (e) => e.type === "role:start" && (rounds > 1 ? events.slice(0, events.indexOf(e)).some((x) => x.type === "round:start" && x.round === 2) && ++seen === 2 : ++seen === Math.min(2, t.nodes.length)));
      const midGrid = horizontal(d, mid, { sight: false });
      out.push(section("horizontal, running", toText(midGrid)), section("its run colours", meaningsOf(midGrid)));
      if (t.consults.length) {
        const asking = stateAt(events, (e) => e.type === "consult:start");
        const g = horizontal(d, asking, { sight: false });
        out.push(section("horizontal, a consult in progress", toText(g)), section("its run colours", meaningsOf(g)));
      }
      const end = stateAt(events, () => false);
      const endGrid = horizontal(d, end, { sight: false });
      out.push(section("horizontal, finished", toText(endGrid)), section("its run colours", meaningsOf(endGrid)));
      out.push(section("vertical, running, 80 columns", toText(vertical(d, mid, { width: 80, sight: false }))));
      out.push(section("strip, running", toText(strip(d, mid))), section("strip, finished", toText(strip(d, end))));
      await expect(out.join("\n")).toMatchFileSnapshot(`./__grid__/${id}.txt`);
    });
  }

  it("marks Critique's flags and interventions on the round they happened in", async () => {
    const t = getRecipe("deep-reasoning")!;
    const events = await scriptedRun(t);
    const at = events.findIndex((e) => e.type === "round:end");
    events.splice(at, 0, { type: "signal", round: 1, from: "critic", signal: "intervention" });
    const s = stateAt(events, (e) => e.type === "round:start" && e.round === 2);
    expect(s.rounds[0]).toEqual({ state: "fail", flag: true });
    const g = toText(horizontal(drawingOf(t), s, { sight: false }));
    expect(g).toContain("●⚑ ◉ ○ at most 3");
  });

  it("chooses horizontal when it fits, vertical down to 80 columns, the strip below", () => {
    const d = drawingOf(getRecipe("deep-reasoning")!);
    const wide = horizontalWidth(d);
    expect(layoutFor(d, wide)).toBe("horizontal");
    expect(layoutFor(d, wide - 1)).toBe("vertical");
    expect(layoutFor(d, 80)).toBe("vertical");
    expect(layoutFor(d, 79)).toBe("strip");
    expect(vertical(d, undefined, { width: 80 }).usedWidth()).toBeLessThanOrEqual(80);
    // The Ralph Loop is narrow enough to stay horizontal at 80 columns.
    expect(layoutFor(drawingOf(getRecipe("ralph-loop")!), 80)).toBe("horizontal");
    // The strip wraps at its arrows to stay inside a narrow screen.
    for (const line of toText(strip(d, undefined, { width: 40 })).split("\n")) expect([...line].length).toBeLessThanOrEqual(40);
  });

  it("cuts a long name to the gutter, so it never runs into the first box", () => {
    const t = structuredClone(getRecipe("exec-eval")!) as Topology;
    t.name = "Generate code and review flow, imported";
    const lines = toText(horizontal(drawingOf(t))).split("\n");
    const box = lines.findIndex((l) => l.includes("┌"));
    const left = [...lines[box]].indexOf("┌");
    for (const l of lines.slice(box, box + 5)) expect(["┌", "│", "└"]).toContain([...l][left]);
  });

  it("renders the same characters to ANSI, with colour only for a run's state", async () => {
    const t = getRecipe("exec-eval")!;
    const events = await scriptedRun(t);
    const s = stateAt(events, (e) => e.type === "role:start");
    const g = horizontal(drawingOf(t), s);
    const ansi = toANSI(g);
    expect(stripANSI(ansi)).toBe(toText(g));
    const hues = [...ansi.matchAll(/\x1b\[([0-9;]+)m/g)].map((m) => m[1]).filter((c) => /(^|;)3[0-7]$/.test(c));
    expect(new Set(hues)).toEqual(new Set(["1;32"]));
  });
});

describe("a way back's label", () => {
  it("never draws over its arc's corner: one too long for the arc goes after it, whole", () => {
    // Three roles, the way back from the third to the first, labelled longer than its arc.
    const t = structuredClone(getRecipe("supervised-coder")!);
    t.waysBack = t.waysBack.map((w) => ({ ...w, label: "tests fail: back to Do" }));
    for (const d of [drawingOf(t, { model: "m" }), drawingOf(getRecipe("exec-eval")!, { model: "m" })]) {
      const rows = toText(horizontal(d)).split("\n");
      const lane = rows.find((r) => r.includes("↺"))!;
      const below = rows[rows.indexOf(lane) + 1];
      // The corner closes the lane above its down stroke, and the label follows it.
      const corner = lane.indexOf("╮");
      expect(corner, lane).toBeGreaterThan(0);
      expect(below[corner], below).toBe("│");
      expect(lane.indexOf("↺")).toBeGreaterThan(corner);
      expect(lane).toContain(`↺ ${d.back[0].label}`);
    }
  });
});
