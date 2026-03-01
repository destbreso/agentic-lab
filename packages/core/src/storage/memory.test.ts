// ============================================
// InMemoryStorage — Unit Tests
// ============================================
// Tests for the in-memory storage implementation,
// covering the bugs fixed (successfulRuns, eventTypes filter)
// and core CRUD operations.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryStorage } from "./memory.js";

describe("InMemoryStorage", () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.init();
  });

  // ------- RunStore -------

  describe("RunStore", () => {
    it("creates and retrieves a run", async () => {
      const run = await storage.runs.createRun({
        externalId: "run-1",
        status: "running",
        provider: "openai",
        model: "gpt-4",
        systemPrompt: "test",
        startedAt: new Date().toISOString(),
        tags: ["test"],
        totalTokens: 0,
        totalToolCalls: 0,
        iterations: 0,
        estimatedCost: 0,
      });

      expect(run.id).toBeDefined();
      expect(run.externalId).toBe("run-1");
      expect(run.createdAt).toBeDefined();

      const retrieved = await storage.runs.getRun("run-1");
      expect(retrieved).toEqual(run);
    });

    it("returns null for non-existent run", async () => {
      const result = await storage.runs.getRun("nonexistent");
      expect(result).toBeNull();
    });

    it("updates a run", async () => {
      await storage.runs.createRun({
        externalId: "run-2",
        status: "running",
        provider: "openai",
        model: "gpt-4",
        systemPrompt: "test",
        startedAt: new Date().toISOString(),
        tags: [],
        totalTokens: 0,
        totalToolCalls: 0,
        iterations: 0,
        estimatedCost: 0,
      });

      const updated = await storage.runs.updateRun("run-2", {
        status: "completed",
        totalTokens: 1000,
      });

      expect(updated?.status).toBe("completed");
      expect(updated?.totalTokens).toBe(1000);
    });

    it("lists with status filter", async () => {
      for (const status of ["running", "completed", "completed"] as const) {
        await storage.runs.createRun({
          externalId: `run-${Math.random()}`,
          status,
          provider: "openai",
          model: "gpt-4",
          systemPrompt: "t",
          startedAt: new Date().toISOString(),
          tags: [],
          totalTokens: 0,
          totalToolCalls: 0,
          iterations: 0,
          estimatedCost: 0,
        });
      }

      const { runs, total } = await storage.runs.listRuns({
        status: "completed",
      });
      expect(runs).toHaveLength(2);
      expect(total).toBe(2);
    });

    it("lists with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.runs.createRun({
          externalId: `run-pg-${i}`,
          status: "completed",
          provider: "openai",
          model: "gpt-4",
          systemPrompt: "t",
          startedAt: new Date().toISOString(),
          tags: [],
          totalTokens: 0,
          totalToolCalls: 0,
          iterations: 0,
          estimatedCost: 0,
        });
      }

      const page1 = await storage.runs.listRuns({ limit: 2, offset: 0 });
      expect(page1.runs).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await storage.runs.listRuns({ limit: 2, offset: 2 });
      expect(page2.runs).toHaveLength(2);
    });

    it("deletes a run", async () => {
      await storage.runs.createRun({
        externalId: "run-del",
        status: "completed",
        provider: "openai",
        model: "gpt-4",
        systemPrompt: "",
        startedAt: new Date().toISOString(),
        tags: [],
        totalTokens: 0,
        totalToolCalls: 0,
        iterations: 0,
        estimatedCost: 0,
      });

      const deleted = await storage.runs.deleteRun("run-del");
      expect(deleted).toBe(true);
      expect(await storage.runs.getRun("run-del")).toBeNull();
    });

    it("saves and retrieves iterations", async () => {
      const iteration = await storage.runs.saveIteration({
        runId: "run-1",
        number: 1,
        response: "hello",
        tokenUsage: { input: 10, output: 5, total: 15 },
        toolCalls: [],
        durationMs: 100,
        timestamp: new Date().toISOString(),
      });

      expect(iteration.id).toBeDefined();
      const retrieved = await storage.runs.getIterations("run-1");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].number).toBe(1);
    });

    it("computes tool stats", async () => {
      await storage.runs.saveToolCall({
        iterationId: "iter-1",
        runId: "run-1",
        name: "file_read",
        arguments: {},
        result: "ok",
        durationMs: 50,
        isError: false,
        timestamp: new Date().toISOString(),
      });
      await storage.runs.saveToolCall({
        iterationId: "iter-1",
        runId: "run-1",
        name: "file_read",
        arguments: {},
        result: "",
        durationMs: 150,
        isError: true,
        timestamp: new Date().toISOString(),
      });

      const stats = await storage.runs.getToolStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].name).toBe("file_read");
      expect(stats[0].count).toBe(2);
      expect(stats[0].errorCount).toBe(1);
      expect(stats[0].avgDurationMs).toBe(100);
    });
  });

  // ------- EventStore -------

  describe("EventStore", () => {
    it("emits and retrieves events", async () => {
      await storage.events.emit("run-1", "iteration_start", { n: 1 });
      await storage.events.emit("run-1", "tool_call", {
        tool: "shell",
      });

      const events = await storage.events.getEvents("run-1");
      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe("iteration_start");
    });

    it("filters events by type", async () => {
      await storage.events.emit("run-1", "iteration_start", {});
      await storage.events.emit("run-1", "tool_call", {});
      await storage.events.emit("run-1", "iteration_end", {});

      const toolEvents = await storage.events.getEvents("run-1", {
        eventType: "tool_call",
      });
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].eventType).toBe("tool_call");
    });

    it("subscribe receives events", async () => {
      const received: string[] = [];
      storage.events.subscribe("run-1", (event) => {
        received.push(event.eventType);
      });

      await storage.events.emit("run-1", "iteration_start", {});
      await storage.events.emit("run-1", "tool_call", {});

      expect(received).toEqual(["iteration_start", "tool_call"]);
    });

    it("subscribe filters by eventTypes (bug fix verification)", async () => {
      const received: string[] = [];
      storage.events.subscribe(
        "run-1",
        (event) => {
          received.push(event.eventType);
        },
        { eventTypes: ["tool_call"] },
      );

      await storage.events.emit("run-1", "iteration_start", {});
      await storage.events.emit("run-1", "tool_call", {});
      await storage.events.emit("run-1", "iteration_end", {});

      // Only tool_call should have been received
      expect(received).toEqual(["tool_call"]);
    });

    it("unsubscribe stops event delivery", async () => {
      const received: string[] = [];
      const unsubscribe = storage.events.subscribe("run-1", (event) => {
        received.push(event.eventType);
      });

      await storage.events.emit("run-1", "first", {});
      unsubscribe();
      await storage.events.emit("run-1", "second", {});

      expect(received).toEqual(["first"]);
    });
  });

  // ------- UsageStore -------

  describe("UsageStore", () => {
    it("records and retrieves by provider", async () => {
      await storage.usage.record({
        runId: "run-1",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.01,
      });
      await storage.usage.record({
        runId: "run-2",
        provider: "anthropic",
        model: "claude",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        estimatedCost: 0.02,
      });

      const openaiUsage = await storage.usage.getByProvider("openai");
      expect(openaiUsage).toHaveLength(1);
      expect(openaiUsage[0].provider).toBe("openai");
    });

    it("getDailyStats counts successfulRuns (bug fix verification)", async () => {
      await storage.usage.record({
        runId: "run-1",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.01,
      });
      await storage.usage.record({
        runId: "run-2",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.01,
      });

      const stats = await storage.usage.getDailyStats(7);
      expect(stats).toHaveLength(1); // All in same day
      expect(stats[0].successfulRuns).toBeGreaterThan(0);
      expect(stats[0].runs).toBe(2);
    });

    it("getTotalCost aggregates correctly", async () => {
      await storage.usage.record({
        runId: "run-1",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.05,
      });
      await storage.usage.record({
        runId: "run-2",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        estimatedCost: 0.1,
      });

      const total = await storage.usage.getTotalCost();
      expect(total).toBeCloseTo(0.15, 5);
    });

    it("getTotalCost filters by provider", async () => {
      await storage.usage.record({
        runId: "run-1",
        provider: "openai",
        model: "gpt-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.05,
      });
      await storage.usage.record({
        runId: "run-2",
        provider: "anthropic",
        model: "claude",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        estimatedCost: 0.1,
      });

      const total = await storage.usage.getTotalCost({ provider: "openai" });
      expect(total).toBeCloseTo(0.05, 5);
    });
  });

  // ------- CheckpointStore -------

  describe("CheckpointStore", () => {
    it("saves and retrieves checkpoints", async () => {
      await storage.checkpoints.save({
        runId: "run-1",
        iteration: 1,
        state: { context: "test" },
        messages: [{ role: "user", content: "hi" }],
      });

      const latest = await storage.checkpoints.getLatest("run-1");
      expect(latest).toBeDefined();
      expect(latest!.iteration).toBe(1);
      expect(latest!.state).toEqual({ context: "test" });
    });

    it("getLatest returns most recent iteration", async () => {
      await storage.checkpoints.save({
        runId: "run-1",
        iteration: 1,
        state: {},
        messages: [],
      });
      await storage.checkpoints.save({
        runId: "run-1",
        iteration: 5,
        state: { latest: true },
        messages: [],
      });
      await storage.checkpoints.save({
        runId: "run-1",
        iteration: 3,
        state: {},
        messages: [],
      });

      const latest = await storage.checkpoints.getLatest("run-1");
      expect(latest!.iteration).toBe(5);
      expect(latest!.state).toEqual({ latest: true });
    });

    it("lists all checkpoints sorted by iteration", async () => {
      for (const iter of [3, 1, 5, 2]) {
        await storage.checkpoints.save({
          runId: "run-1",
          iteration: iter,
          state: {},
          messages: [],
        });
      }

      const list = await storage.checkpoints.list("run-1");
      expect(list.map((c) => c.iteration)).toEqual([1, 2, 3, 5]);
    });
  });

  // ------- MemoryStore -------

  describe("MemoryStore", () => {
    it("puts and gets items", async () => {
      await storage.memory.put(["agent", "facts"], "lang", {
        value: "TypeScript",
      });

      const item = await storage.memory.get(["agent", "facts"], "lang");
      expect(item).toBeDefined();
      expect(item!.value).toEqual({ value: "TypeScript" });
    });

    it("updates existing items preserving id", async () => {
      const first = await storage.memory.put(["ns"], "key", { v: 1 });
      const second = await storage.memory.put(["ns"], "key", { v: 2 });

      expect(second.id).toBe(first.id);
      expect(second.value).toEqual({ v: 2 });
    });

    it("searches by namespace", async () => {
      await storage.memory.put(["ns1"], "a", { v: 1 });
      await storage.memory.put(["ns1"], "b", { v: 2 });
      await storage.memory.put(["ns2"], "c", { v: 3 });

      const results = await storage.memory.search(["ns1"]);
      expect(results).toHaveLength(2);
    });

    it("semanticSearch throws meaningful error", async () => {
      await expect(
        storage.memory.semanticSearch(["ns"], "query"),
      ).rejects.toThrow("Semantic search not available");
    });

    it("deleteNamespace removes all items", async () => {
      await storage.memory.put(["ns"], "a", { v: 1 });
      await storage.memory.put(["ns"], "b", { v: 2 });
      await storage.memory.deleteNamespace(["ns"]);

      const results = await storage.memory.search(["ns"]);
      expect(results).toHaveLength(0);
    });
  });

  // ------- ChatStore -------

  describe("ChatStore", () => {
    it("creates a session and saves messages", async () => {
      const session = await storage.chat.createSession({
        title: "Test Session",
        agentId: "agent-1",
        provider: "openai",
        model: "gpt-4",
        messageCount: 0,
        tokenCount: 0,
      });

      expect(session.id).toBeDefined();
      expect(session.title).toBe("Test Session");

      await storage.chat.saveMessage({
        sessionId: session.id,
        role: "user",
        content: "hello",
        tokens: 5,
      });

      const messages = await storage.chat.getMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("hello");

      // Should auto-increment counters
      const updated = await storage.chat.getSession(session.id);
      expect(updated!.messageCount).toBe(1);
      expect(updated!.tokenCount).toBe(5);
    });

    it("deletes session and its messages", async () => {
      const session = await storage.chat.createSession({
        title: "To Delete",
        agentId: "agent-1",
        provider: "openai",
        model: "gpt-4",
        messageCount: 0,
        tokenCount: 0,
      });

      await storage.chat.saveMessage({
        sessionId: session.id,
        role: "user",
        content: "bye",
      });

      const deleted = await storage.chat.deleteSession(session.id);
      expect(deleted).toBe(true);
      expect(await storage.chat.getSession(session.id)).toBeNull();
    });
  });

  // ------- healthy -------

  it("healthy returns true", async () => {
    expect(await storage.healthy()).toBe(true);
  });
});
