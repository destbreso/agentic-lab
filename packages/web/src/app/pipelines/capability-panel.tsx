"use client";

// ============================================
// Per-node capability editor
// ============================================
// Structured editor for a node's capabilities: brain (provider+model), tool
// availability (allow-list), attached skills, contextual memory, and the basic
// loop config. Writes back into node.config so recipe instantiation honors it.

import { useState } from "react";
import { Brain, Wrench, Sparkles, Database, Settings2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  configured: boolean;
}
export interface SkillInfo {
  name: string;
  description: string;
  activation: string;
  allowedTools: string[];
}

type Cfg = Record<string, unknown>;
type Brain = { provider?: string; model?: string; temperature?: number; maxTokens?: number };
type ToolPolicy = { allow?: string[]; deny?: string[] };
type Memory = { contextual?: boolean; writeScope?: string; readScopes?: string[]; topK?: number };

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="flex-1 text-xs font-semibold text-zinc-200">{title}</span>
        {badge && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{badge}</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-2 border-t border-zinc-800 p-3">{children}</div>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20";
const labelCls = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500";

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        value ? "bg-blue-600" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          value ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function CapabilityEditor({
  config,
  providers,
  skills,
  tools,
  onChange,
}: {
  config: Cfg;
  category: string;
  providers: ProviderInfo[];
  skills: SkillInfo[];
  tools: string[];
  onChange: (config: Cfg) => void;
}) {
  const brain = (config.brain as Brain) || {};
  const toolPolicy = (config.toolPolicy as ToolPolicy) || {};
  const attachedSkills = (config.skills as string[]) || [];
  const memory = (config.memory as Memory) || {};

  const patch = (updates: Cfg) => onChange({ ...config, ...updates });
  const patchBrain = (u: Partial<Brain>) => patch({ brain: { ...brain, ...u } });
  const patchMemory = (u: Partial<Memory>) => patch({ memory: { ...memory, ...u } });

  const allow = toolPolicy.allow ?? [];
  const toggleTool = (t: string) => {
    const next = allow.includes(t) ? allow.filter((x) => x !== t) : [...allow, t];
    patch({ toolPolicy: { ...toolPolicy, allow: next.length ? next : undefined } });
  };
  const toggleSkill = (name: string) => {
    const next = attachedSkills.includes(name)
      ? attachedSkills.filter((x) => x !== name)
      : [...attachedSkills, name];
    patch({ skills: next.length ? next : undefined });
  };

  const selectedProvider = providers.find((p) => p.id === brain.provider);

  return (
    <div className="space-y-2.5">
      {/* Brain */}
      <Section title="Brain (model)" icon={Brain} badge={brain.provider || "inherit"}>
        <div>
          <label className={labelCls}>Provider</label>
          <select
            value={brain.provider ?? ""}
            onChange={(e) => patchBrain({ provider: e.target.value || undefined })}
            className={inputCls}
          >
            <option value="">Inherit from session</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.configured ? "" : " (no key)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Model</label>
          <input
            list={`models-${brain.provider ?? "none"}`}
            value={brain.model ?? ""}
            onChange={(e) => patchBrain({ model: e.target.value || undefined })}
            placeholder="inherit"
            className={inputCls}
          />
          <datalist id={`models-${brain.provider ?? "none"}`}>
            {(selectedProvider?.models ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={(config.temperature as number | undefined) ?? ""}
              onChange={(e) =>
                patch({ temperature: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              placeholder="default"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Max tokens</label>
            <input
              type="number"
              value={(config.maxTokens as number | undefined) ?? ""}
              onChange={(e) =>
                patch({ maxTokens: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              placeholder="default"
              className={inputCls}
            />
          </div>
        </div>
      </Section>

      {/* Tools */}
      <Section title="Tools" icon={Wrench} badge={allow.length ? `${allow.length}` : "all"}>
        <p className="text-[10px] text-zinc-500">
          {allow.length === 0
            ? "No restriction — node sees the full toolkit."
            : "Only the selected tools are available to this node."}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {tools.map((t) => {
            const on = allow.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTool(t)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  on
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Skills */}
      <Section
        title="Skills"
        icon={Sparkles}
        badge={attachedSkills.length ? `${attachedSkills.length}` : "0"}
        defaultOpen={false}
      >
        {skills.length === 0 ? (
          <p className="text-[10px] text-zinc-500">No skills available.</p>
        ) : (
          <div className="space-y-1.5">
            {skills.map((s) => {
              const on = attachedSkills.includes(s.name);
              return (
                <button
                  key={s.name}
                  onClick={() => toggleSkill(s.name)}
                  className={cn(
                    "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                    on
                      ? "border-violet-500/40 bg-violet-500/10"
                      : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-[11px] font-medium", on ? "text-violet-300" : "text-zinc-300")}>
                      {s.name}
                    </span>
                    <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">
                      {s.activation}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-500">{s.description}</p>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* Memory */}
      <Section title="Memory" icon={Database} badge={memory.contextual ? "on" : "off"} defaultOpen={false}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-300">Contextual recall</span>
          <Toggle value={Boolean(memory.contextual)} onChange={(v) => patchMemory({ contextual: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Write scope</label>
            <input
              value={memory.writeScope ?? ""}
              onChange={(e) => patchMemory({ writeScope: e.target.value || undefined })}
              placeholder="shared"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Top-K</label>
            <input
              type="number"
              value={memory.topK ?? ""}
              onChange={(e) =>
                patchMemory({ topK: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              placeholder="5"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Read scopes (comma-separated)</label>
          <input
            value={(memory.readScopes ?? []).join(", ")}
            onChange={(e) =>
              patchMemory({
                readScopes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="shared"
            className={inputCls}
          />
        </div>
      </Section>

      {/* Loop config */}
      <Section title="Loop config" icon={Settings2} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Max iterations</label>
            <input
              type="number"
              value={(config.maxIterations as number) ?? 1}
              onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Delay (ms)</label>
            <input
              type="number"
              value={(config.delayMs as number) ?? 0}
              onChange={(e) => patch({ delayMs: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-300">Concurrent</span>
          <Toggle
            value={Boolean(config.concurrent)}
            onChange={(v) => patch({ concurrent: v })}
          />
        </div>
      </Section>
    </div>
  );
}
