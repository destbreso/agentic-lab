// The names before jig-core 0.1.7 still work, as deprecated aliases, until 0.2.0.

import { describe, it, expect } from "vitest";
import { AgentSession, TopologyRun, createProvider, type AgentRunResult, type AgentSessionConfig, type RunEvent, type RunResult, type SessionEvent, type TopologyRunConfig } from "../index.js";

describe("the names before 0.1.7", () => {
  it("are the class and the types they were renamed to", () => {
    expect(AgentSession).toBe(TopologyRun);
    const config: AgentSessionConfig = { provider: createProvider("ollama", { model: "m" }) } satisfies TopologyRunConfig;
    expect(new AgentSession(config)).toBeInstanceOf(TopologyRun);
    const event: SessionEvent | undefined = undefined as RunEvent | undefined;
    const result: AgentRunResult | undefined = undefined as RunResult | undefined;
    expect([event, result]).toEqual([undefined, undefined]);
  });
});
