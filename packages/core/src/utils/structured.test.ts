// ============================================
// Structured Output Parsing — Unit Tests
// ============================================

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  extractJSON,
  safeJSONParse,
  parseStructured,
  jsonFormatInstruction,
} from "./structured.js";

describe("extractJSON", () => {
  it("extracts a ```json fenced block", () => {
    const text = 'Here you go:\n```json\n{"a": 1}\n```\nDone.';
    expect(extractJSON(text)).toBe('{"a": 1}');
  });

  it("extracts a bare ``` fenced block", () => {
    const text = "```\n{\"a\": 1, \"b\": [2, 3]}\n```";
    expect(extractJSON(text)).toBe('{"a": 1, "b": [2, 3]}');
  });

  it("extracts a balanced object embedded in prose", () => {
    const text = 'The verdict is {"verdict": "pass"} based on the diff.';
    expect(extractJSON(text)).toBe('{"verdict": "pass"}');
  });

  it("respects braces inside string literals", () => {
    const text = 'prefix {"msg": "a } b", "ok": true} suffix';
    expect(extractJSON(text)).toBe('{"msg": "a } b", "ok": true}');
  });

  it("extracts a top-level array", () => {
    expect(extractJSON("[1, 2, 3]")).toBe("[1, 2, 3]");
  });

  it("returns null when there is no JSON", () => {
    expect(extractJSON("just prose, no json here")).toBeNull();
    expect(extractJSON("")).toBeNull();
  });
});

describe("safeJSONParse", () => {
  it("parses valid JSON", () => {
    expect(safeJSONParse('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns null on invalid JSON", () => {
    expect(safeJSONParse("{not json")).toBeNull();
  });
});

describe("parseStructured", () => {
  const schema = z.object({
    verdict: z.enum(["pass", "fail"]),
    confidence: z.number().min(0).max(1).default(0.5),
  });

  it("parses and validates clean JSON (happy path)", () => {
    const res = parseStructured(schema, '{"verdict":"pass","confidence":0.9}');
    expect(res.success).toBe(true);
    expect(res.usedFallback).toBe(false);
    expect(res.data).toEqual({ verdict: "pass", confidence: 0.9 });
  });

  it("parses JSON wrapped in prose + fences", () => {
    const res = parseStructured(
      schema,
      'Sure!\n```json\n{"verdict":"fail"}\n```',
    );
    expect(res.success).toBe(true);
    expect(res.data?.verdict).toBe("fail");
    // default applied for missing field
    expect(res.data?.confidence).toBe(0.5);
  });

  it("uses recover() when JSON is absent", () => {
    const res = parseStructured(schema, "VERDICT: pass", {
      recover: (raw) =>
        /pass/i.test(raw) ? { verdict: "pass", confidence: 0.5 } : null,
    });
    expect(res.success).toBe(false);
    expect(res.usedFallback).toBe(true);
    expect(res.data?.verdict).toBe("pass");
    expect(res.error).toBeDefined();
  });

  it("uses fallback when JSON and recover both fail", () => {
    const res = parseStructured(schema, "garbage", {
      fallback: { verdict: "fail", confidence: 0 },
    });
    expect(res.success).toBe(false);
    expect(res.usedFallback).toBe(true);
    expect(res.data).toEqual({ verdict: "fail", confidence: 0 });
  });

  it("falls through to recover when JSON is present but invalid", () => {
    // Valid JSON shape but wrong enum value → schema rejects → recover kicks in
    const res = parseStructured(schema, '{"verdict":"maybe"}', {
      recover: () => ({ verdict: "fail", confidence: 0.2 }),
    });
    expect(res.success).toBe(false);
    expect(res.usedFallback).toBe(true);
    expect(res.data?.verdict).toBe("fail");
  });

  it("returns data=null when nothing works and no fallback", () => {
    const res = parseStructured(schema, "nope");
    expect(res.success).toBe(false);
    expect(res.usedFallback).toBe(false);
    expect(res.data).toBeNull();
  });
});

describe("jsonFormatInstruction", () => {
  it("includes the provided shape", () => {
    const instr = jsonFormatInstruction('{ "verdict": "pass|fail" }');
    expect(instr).toContain("SINGLE valid JSON");
    expect(instr).toContain('"verdict": "pass|fail"');
  });
});
