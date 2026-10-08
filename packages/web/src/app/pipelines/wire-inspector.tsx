"use client";

// ============================================
// Wire inspector — feedback rules at the wire level
// ============================================
// A wire is more than a pipe: it can carry a declarative feedback rule —
// "only route signal X when a condition holds, re-typed as Y, at most N times".
// This panel edits that rule. It is the serializable cousin of the core
// FeedbackRuleDef: everything here is plain data that compiles into the wire's
// filter + transform at run time, so a loop authored visually behaves exactly
// like a hand-wired feedback edge.

import { useState } from "react";
import { ArrowRight, Filter, Shuffle, Plus, Trash2, X, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

export type WirePredicateOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "truthy"
  | "falsy"
  | "contains";

export interface WirePredicate {
  field: string;
  op: WirePredicateOp;
  value?: string | number | boolean;
}

export interface WireFeedback {
  whenSignal?: string;
  where?: WirePredicate[];
  asSignal?: string;
  set?: Record<string, unknown>;
  maxFires?: number;
}

const OPS: { value: WirePredicateOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "= equals", needsValue: true },
  { value: "ne", label: "≠ not equals", needsValue: true },
  { value: "gt", label: "> greater", needsValue: true },
  { value: "gte", label: "≥ greater/equal", needsValue: true },
  { value: "lt", label: "< less", needsValue: true },
  { value: "lte", label: "≤ less/equal", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "exists", label: "exists", needsValue: false },
  { value: "truthy", label: "is truthy", needsValue: false },
  { value: "falsy", label: "is falsy", needsValue: false },
];

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20";
const labelCls = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500";

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-xs font-semibold text-zinc-200">{title}</span>
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </div>
  );
}

/** Coerce a string to number/boolean when it cleanly looks like one. */
function coerce(v: string): string | number | boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** Drop empty parts so a wire with no meaningful rule stays a plain wire. */
export function normalizeFeedback(fb: WireFeedback): WireFeedback | undefined {
  const where = (fb.where ?? []).filter((p) => p.field.trim() !== "");
  const set = Object.fromEntries(
    Object.entries(fb.set ?? {}).filter(([k]) => k.trim() !== ""),
  );
  const out: WireFeedback = {};
  if (fb.whenSignal?.trim()) out.whenSignal = fb.whenSignal.trim();
  if (where.length) out.where = where;
  if (fb.asSignal?.trim()) out.asSignal = fb.asSignal.trim();
  if (Object.keys(set).length) out.set = set;
  if (fb.maxFires != null && !Number.isNaN(fb.maxFires)) out.maxFires = fb.maxFires;
  return Object.keys(out).length ? out : undefined;
}

/**
 * What the panel edits: every field as the user typed it. Rows may be
 * incomplete while they are being filled in (an empty field, a value still
 * being typed, a half-written number), so the panel keeps its own draft and
 * reports the rule it stands for on every change. The wire stores only the
 * normalized rule; rendering from it would drop a new, still-empty row the
 * moment it is added.
 */
interface DraftPredicate {
  field: string;
  op: WirePredicateOp;
  value: string;
}

interface Draft {
  whenSignal: string;
  where: DraftPredicate[];
  asSignal: string;
  maxFires: string;
  set: [string, string][];
}

function toDraft(fb: WireFeedback): Draft {
  return {
    whenSignal: fb.whenSignal ?? "",
    where: (fb.where ?? []).map((p) => ({
      field: p.field,
      op: p.op,
      value: p.value == null ? "" : String(p.value),
    })),
    asSignal: fb.asSignal ?? "",
    maxFires: fb.maxFires == null ? "" : String(fb.maxFires),
    set: Object.entries(fb.set ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]),
  };
}

/** The rule a draft stands for; normalizeFeedback drops the incomplete parts. */
function fromDraft(d: Draft): WireFeedback {
  const maxFires = d.maxFires.trim() === "" ? undefined : Number(d.maxFires);
  return {
    whenSignal: d.whenSignal.trim() || undefined,
    where: d.where.map((p) =>
      OPS.find((o) => o.value === p.op)?.needsValue === false
        ? { field: p.field.trim(), op: p.op }
        : { field: p.field.trim(), op: p.op, value: coerce(p.value) },
    ),
    asSignal: d.asSignal.trim() || undefined,
    set: Object.fromEntries(
      d.set.filter(([k]) => k.trim() !== "").map(([k, v]) => [k.trim(), coerce(v)]),
    ),
    maxFires: maxFires != null && Number.isFinite(maxFires) && maxFires >= 1 ? maxFires : undefined,
  };
}

export function WireInspector({
  fromLabel,
  toLabel,
  sourceSignalTypes,
  targetSignalTypes,
  feedback,
  onChange,
  onDelete,
  onClose,
}: {
  fromLabel: string;
  toLabel: string;
  sourceSignalTypes: string[];
  targetSignalTypes: string[];
  feedback: WireFeedback;
  onChange: (fb: WireFeedback) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // The parent remounts the panel per wire (key = wire id), so the draft only
  // needs seeding once from the stored rule.
  const [draft, setDraft] = useState<Draft>(() => toDraft(feedback));
  const patch = (u: Partial<Draft>) => {
    const next = { ...draft, ...u };
    setDraft(next);
    onChange(fromDraft(next));
  };
  const where = draft.where;
  const setEntries = draft.set;

  const setWhere = (next: DraftPredicate[]) => patch({ where: next });
  const addPredicate = () => setWhere([...where, { field: "", op: "eq", value: "" }]);
  const updatePredicate = (i: number, u: Partial<DraftPredicate>) =>
    setWhere(where.map((p, idx) => (idx === i ? { ...p, ...u } : p)));
  const removePredicate = (i: number) => setWhere(where.filter((_, idx) => idx !== i));

  const setSet = (entries: [string, string][]) => patch({ set: entries });
  const addSet = () => setSet([...setEntries, ["", ""]]);
  const updateSetKey = (i: number, key: string) =>
    setSet(setEntries.map((e, idx) => (idx === i ? [key, e[1]] : e)));
  const updateSetVal = (i: number, val: string) =>
    setSet(setEntries.map((e, idx) => (idx === i ? [e[0], val] : e)));
  const removeSet = (i: number) => setSet(setEntries.filter((_, idx) => idx !== i));

  return (
    <div className="flex w-80 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-200">Wire / Feedback</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* Connection summary */}
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px]">
          <span className="truncate font-medium text-blue-300">{fromLabel}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" />
          <span className="truncate font-medium text-emerald-300">{toLabel}</span>
        </div>

        <p className="text-[10px] leading-relaxed text-zinc-500">
          A plain wire forwards every signal as-is. Add a condition to gate it, or
          re-type / cap it to build a safe feedback loop.
        </p>

        {/* ── Condition (filter) ── */}
        <Section title="Condition" icon={Filter}>
          <div>
            <label className={labelCls}>Only when signal type</label>
            <input
              list="wire-source-types"
              value={draft.whenSignal}
              onChange={(e) => patch({ whenSignal: e.target.value })}
              placeholder="any"
              className={inputCls}
            />
            <datalist id="wire-source-types">
              {sourceSignalTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={labelCls}>Where (all must pass)</label>
            <div className="space-y-1.5">
              {where.length === 0 && (
                <p className="text-[10px] text-zinc-600">No conditions — routes always.</p>
              )}
              {where.map((p, i) => {
                const op = OPS.find((o) => o.value === p.op);
                return (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      value={p.field}
                      onChange={(e) => updatePredicate(i, { field: e.target.value })}
                      placeholder="field.path"
                      className={cn(inputCls, "flex-1 px-2")}
                    />
                    <select
                      value={p.op}
                      onChange={(e) =>
                        updatePredicate(i, { op: e.target.value as WirePredicateOp })
                      }
                      className={cn(inputCls, "w-[88px] px-1")}
                    >
                      {OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {op?.needsValue && (
                      <input
                        value={p.value}
                        onChange={(e) => updatePredicate(i, { value: e.target.value })}
                        placeholder="value"
                        className={cn(inputCls, "w-16 px-2")}
                      />
                    )}
                    <button
                      onClick={() => removePredicate(i)}
                      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={addPredicate}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" /> Add condition
              </button>
            </div>
          </div>
        </Section>

        {/* ── Routing (transform) ── */}
        <Section title="Routing" icon={Shuffle}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Re-type as</label>
              <input
                list="wire-target-types"
                value={draft.asSignal}
                onChange={(e) => patch({ asSignal: e.target.value })}
                placeholder="keep"
                className={inputCls}
              />
              <datalist id="wire-target-types">
                {targetSignalTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>Max fires</label>
              <input
                type="number"
                min="1"
                value={draft.maxFires}
                onChange={(e) => patch({ maxFires: e.target.value })}
                placeholder="∞"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Set fields (merged into data)</label>
            <div className="space-y-1.5">
              {setEntries.length === 0 && (
                <p className="text-[10px] text-zinc-600">No extra fields.</p>
              )}
              {setEntries.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    value={k}
                    onChange={(e) => updateSetKey(i, e.target.value)}
                    placeholder="key"
                    className={cn(inputCls, "flex-1 px-2")}
                  />
                  <span className="text-zinc-600">=</span>
                  <input
                    value={v}
                    onChange={(e) => updateSetVal(i, e.target.value)}
                    placeholder="value"
                    className={cn(inputCls, "flex-1 px-2")}
                  />
                  <button
                    onClick={() => removeSet(i)}
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={addSet}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>
          </div>
        </Section>
      </div>

      <div className="border-t border-zinc-800 p-4">
        <button
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20"
        >
          <Trash2 className="h-3 w-3" />
          Delete wire
        </button>
      </div>
    </div>
  );
}
