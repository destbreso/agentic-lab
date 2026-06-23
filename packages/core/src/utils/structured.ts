// ============================================
// Structured Output Parsing
// ============================================
// Provider-agnostic structured output: instruct the LLM to emit JSON,
// then robustly extract + validate it against a Zod schema. This works
// with EVERY provider (including local Ollama) because it does not depend
// on a native JSON/response-format mode — it parses whatever text the
// model produces and validates it.
//
// Replaces the fragile regex parsing used across the cognitive loops
// (evaluation/critic/refinement/memory), where a model deviating from an
// exact textual format silently produced wrong signals.

import type { z } from "zod";

export interface StructuredParseResult<T> {
  /** True when `data` came from schema-validated JSON (the happy path). */
  success: boolean;
  /** The resulting value. Null only when parsing failed and no fallback was given. */
  data: T | null;
  /** The raw LLM text that was parsed. */
  raw: string;
  /** Validation/parse error message, if any. */
  error?: string;
  /** True when `data` came from a recover()/fallback path, not validated JSON. */
  usedFallback: boolean;
}

/** Does this string look like a JSON object/array at its boundaries? */
function looksLikeJSON(s: string): boolean {
  return (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  );
}

/**
 * Scan for the first balanced {...} or [...] in `text`, respecting string
 * literals and escapes so braces inside strings don't break the match.
 */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract the most likely JSON payload from arbitrary LLM text.
 * Handles, in order:
 *   1. A ```json fenced block (or a plain ``` fenced block).
 *   2. The first balanced {...} / [...] embedded in prose.
 *   3. The whole text, if it already looks like JSON.
 * Returns the JSON substring, or null if none is found.
 */
export function extractJSON(text: string): string | null {
  if (!text) return null;

  // 1. Fenced ```json ... ``` (or bare ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1].trim()) {
    const inner = fenced[1].trim();
    const balanced = extractBalanced(inner);
    if (balanced) return balanced;
    if (looksLikeJSON(inner)) return inner;
  }

  // 2. First balanced object/array anywhere in the text
  const balanced = extractBalanced(text);
  if (balanced) return balanced;

  // 3. Whole text if it already looks like JSON
  const trimmed = text.trim();
  if (looksLikeJSON(trimmed)) return trimmed;

  return null;
}

/** JSON.parse that returns null instead of throwing. */
export function safeJSONParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ParseStructuredOptions<T> {
  /** Value returned when parsing/validation fails (marks `usedFallback`). */
  fallback?: T;
  /**
   * Secondary recovery parser (e.g. a legacy regex parser) tried before the
   * fallback. Lets callers degrade gracefully without a hard regression.
   */
  recover?: (raw: string) => T | null | undefined;
}

/**
 * Parse + validate structured output against a Zod schema.
 *
 * Attempt order:
 *   1. Extract a JSON payload from the text and validate it (happy path).
 *   2. If that fails and `recover` is provided, try the recovery parser
 *      (its output is also validated when possible, but accepted regardless).
 *   3. If that fails and `fallback` is provided, return the fallback.
 *
 * Never throws — always returns a {@link StructuredParseResult}.
 */
export function parseStructured<T>(
  schema: z.ZodType<T>,
  text: string,
  options: ParseStructuredOptions<T> = {},
): StructuredParseResult<T> {
  const raw = text ?? "";
  let validationError: string | undefined;

  // 1. JSON + schema validation
  const json = extractJSON(raw);
  if (json !== null) {
    const parsed = safeJSONParse(json);
    if (parsed !== null) {
      const result = schema.safeParse(parsed);
      if (result.success) {
        return { success: true, data: result.data, raw, usedFallback: false };
      }
      validationError = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    } else {
      validationError = "extracted text was not valid JSON";
    }
  } else {
    validationError = "no JSON payload found in response";
  }

  // 2. recover()
  if (options.recover) {
    const recovered = options.recover(raw);
    if (recovered != null) {
      const result = schema.safeParse(recovered);
      return {
        success: false,
        data: result.success ? result.data : recovered,
        raw,
        usedFallback: true,
        error: validationError,
      };
    }
  }

  // 3. fallback
  if (options.fallback !== undefined) {
    return {
      success: false,
      data: options.fallback,
      raw,
      usedFallback: true,
      error: validationError,
    };
  }

  return { success: false, data: null, raw, usedFallback: false, error: validationError };
}

/**
 * Build a concise instruction telling the model to emit a single JSON object.
 * `shape` is a human-readable description of the expected fields (kept simple
 * on purpose — we validate with Zod, not with a strict JSON schema prompt).
 */
export function jsonFormatInstruction(shape: string): string {
  return (
    "Respond with a SINGLE valid JSON object and nothing else — " +
    "no surrounding prose, no markdown code fences.\n" +
    "The JSON object must have this shape:\n" +
    shape
  );
}
