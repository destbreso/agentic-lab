// ============================================
// Skill Activation
// ============================================
// Decides which skills become active for a given task/context.
//
//   - "always" skills are always active (on the nodes they're attached to).
//   - "manual" skills are active when explicitly attached/requested.
//   - "auto"   skills are activated by RELEVANCE to the current task:
//       * semantic (embeddings) when an embedding function is available,
//       * heuristic (keyword overlap) otherwise — graceful degradation.

import type { EmbeddingFunction } from "../storage/qdrant.js";
import type { Skill, ActiveSkill } from "./types.js";

export interface ActivationContext {
  /** The task / current context text used for relevance matching. */
  query: string;
  /** Skill names explicitly attached to the node (force-activated). */
  manualSkills?: string[];
}

export interface ActivateOptions {
  /** Embedding function — when provided, auto-activation is semantic. */
  embed?: EmbeddingFunction;
  /** Relevance threshold (cosine for semantic; default 0.6). */
  threshold?: number;
  /** Minimum shared terms for heuristic activation (default 1). */
  minSharedTerms?: number;
  /** Cap on the number of auto-activated skills (default 3). */
  maxAuto?: number;
}

/** Cosine similarity of two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "be", "this", "that", "it", "as", "by", "at", "from", "into", "your",
  "you", "we", "our", "i",
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Searchable text representation of a skill. */
function skillText(skill: Skill): string {
  return [skill.name, skill.description, ...(skill.keywords ?? [])].join(". ");
}

/** Heuristic relevance: shared meaningful terms between query and skill. */
export function heuristicSharedTerms(query: string, skill: Skill): number {
  const q = tokenize(query);
  const s = tokenize(skillText(skill));
  let shared = 0;
  for (const t of s) if (q.has(t)) shared++;
  return shared;
}

/**
 * Resolve the active skills for a context. Returns always + manual skills
 * first, then relevance-ranked auto skills (deduped by name).
 */
export async function resolveActiveSkills(
  skills: Skill[],
  ctx: ActivationContext,
  opts: ActivateOptions = {},
): Promise<ActiveSkill[]> {
  const threshold = opts.threshold ?? 0.6;
  const minShared = opts.minSharedTerms ?? 1;
  const maxAuto = opts.maxAuto ?? 3;
  const manual = new Set(ctx.manualSkills ?? []);

  const chosen = new Map<string, ActiveSkill>();

  // 1. always
  for (const skill of skills) {
    if (skill.activation === "always") {
      chosen.set(skill.name, { skill, reason: "always" });
    }
  }

  // 2. manual (explicit attach overrides; wins over a prior "always" entry too)
  for (const skill of skills) {
    if (manual.has(skill.name)) {
      chosen.set(skill.name, { skill, reason: "manual" });
    }
  }

  // 3. auto (relevance-ranked)
  const autoCandidates = skills.filter(
    (s) => s.activation === "auto" && !chosen.has(s.name),
  );

  const scored: ActiveSkill[] = [];
  if (autoCandidates.length > 0) {
    if (opts.embed) {
      // Semantic
      const queryVec = await opts.embed(ctx.query);
      for (const skill of autoCandidates) {
        const vec = await opts.embed(skillText(skill));
        const score = cosineSimilarity(queryVec, vec);
        if (score >= threshold) scored.push({ skill, reason: "auto", score });
      }
    } else {
      // Heuristic fallback
      for (const skill of autoCandidates) {
        const shared = heuristicSharedTerms(ctx.query, skill);
        if (shared >= minShared) {
          scored.push({ skill, reason: "auto", score: shared });
        }
      }
    }
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const item of scored.slice(0, maxAuto)) {
      chosen.set(item.skill.name, item);
    }
  }

  // Order: always/manual (static) first, then auto by score.
  const statics: ActiveSkill[] = [];
  const autos: ActiveSkill[] = [];
  for (const item of chosen.values()) {
    if (item.reason === "auto") autos.push(item);
    else statics.push(item);
  }
  autos.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [...statics, ...autos];
}

/**
 * Select only the static skills (always + manual) — no query needed.
 * Useful at pipeline-instantiation time, before a task is known.
 */
export function selectStaticSkills(
  skills: Skill[],
  manualSkills: string[] = [],
): ActiveSkill[] {
  const manual = new Set(manualSkills);
  const chosen = new Map<string, ActiveSkill>();
  for (const skill of skills) {
    if (skill.activation === "always") {
      chosen.set(skill.name, { skill, reason: "always" });
    }
  }
  for (const skill of skills) {
    if (manual.has(skill.name)) {
      chosen.set(skill.name, { skill, reason: "manual" });
    }
  }
  return Array.from(chosen.values());
}
