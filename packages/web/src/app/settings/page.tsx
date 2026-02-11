"use client";

import { useState } from "react";
import {
  Settings,
  Save,
  RotateCcw,
  Database,
  Cpu,
  Globe,
  Shield,
  Palette,
  Bell,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────── */

interface SettingsState {
  // General
  defaultProvider: string;
  defaultModel: string;
  maxIterations: number;
  delayMs: number;
  // Infrastructure
  postgresUrl: string;
  redisUrl: string;
  qdrantUrl: string;
  // Appearance
  theme: "dark" | "light" | "system";
  compactMode: boolean;
  showTokenCounts: boolean;
  // Notifications
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  // Advanced
  debugMode: boolean;
  telemetry: boolean;
  logLevel: string;
}

const DEFAULT_SETTINGS: SettingsState = {
  defaultProvider: "ollama",
  defaultModel: "llama3.1:8b",
  maxIterations: 20,
  delayMs: 500,
  postgresUrl: "postgresql://agentic:agentic@localhost:5432/agentic_lab",
  redisUrl: "redis://localhost:6379",
  qdrantUrl: "http://localhost:6333",
  theme: "dark",
  compactMode: false,
  showTokenCounts: true,
  notifyOnComplete: true,
  notifyOnError: true,
  debugMode: false,
  telemetry: false,
  logLevel: "info",
};

/* ─── Sub-components ─────────────────────────────── */

function SettingSection({
  title,
  description,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className={cn("h-4 w-4", iconColor)} />
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-zinc-200">{label}</p>
        {description && (
          <p className="text-[11px] text-zinc-500">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  className: extraClass,
}: {
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20",
        extraClass || "w-56",
      )}
    />
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        value ? "bg-blue-600" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white transition-transform",
          value ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/* ─── Tabs ───────────────────────────────────────── */

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "infra", label: "Infrastructure", icon: Database },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "advanced", label: "Advanced", icon: Terminal },
];

/* ─── Main Page ──────────────────────────────────── */

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState("general");
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    // In production, POST to API
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setSaved(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 animate-in fade-in">
      {/* Tab Nav */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl bg-zinc-800/50 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <Badge variant="success" className="animate-in fade-in text-xs">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Saved
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="mr-1 h-3 w-3" />
            Save
          </Button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "general" && (
        <div className="space-y-4 animate-in fade-in">
          <SettingSection
            title="Default Provider"
            description="Configure the default LLM provider and model for new runs"
            icon={Cpu}
            iconColor="text-blue-400"
          >
            <FieldRow
              label="Provider"
              description="The LLM provider to use by default"
            >
              <SelectInput
                value={settings.defaultProvider}
                options={[
                  { value: "ollama", label: "Ollama (Local)" },
                  { value: "openai", label: "OpenAI" },
                  { value: "anthropic", label: "Anthropic" },
                ]}
                onChange={(v) => update("defaultProvider", v)}
              />
            </FieldRow>
            <FieldRow
              label="Model"
              description="Default model for the selected provider"
            >
              <TextInput
                value={settings.defaultModel}
                onChange={(v) => update("defaultModel", v)}
                placeholder="e.g. llama3.1:8b"
              />
            </FieldRow>
          </SettingSection>

          <SettingSection
            title="Execution Defaults"
            description="Default parameters for loop execution"
            icon={Shield}
            iconColor="text-amber-400"
          >
            <FieldRow
              label="Max Iterations"
              description="Safety limit to prevent infinite loops"
            >
              <TextInput
                type="number"
                value={settings.maxIterations}
                onChange={(v) => update("maxIterations", Number(v))}
              />
            </FieldRow>
            <FieldRow
              label="Delay (ms)"
              description="Pause between loop iterations"
            >
              <TextInput
                type="number"
                value={settings.delayMs}
                onChange={(v) => update("delayMs", Number(v))}
              />
            </FieldRow>
          </SettingSection>
        </div>
      )}

      {activeTab === "infra" && (
        <div className="space-y-4 animate-in fade-in">
          <SettingSection
            title="Infrastructure"
            description="Connection strings for storage and messaging services"
            icon={Database}
            iconColor="text-emerald-400"
          >
            <FieldRow label="PostgreSQL" description="Primary data store">
              <TextInput
                value={settings.postgresUrl}
                onChange={(v) => update("postgresUrl", v)}
                className="w-80 font-mono text-xs"
              />
            </FieldRow>
            <FieldRow label="Redis" description="Event bus and caching">
              <TextInput
                value={settings.redisUrl}
                onChange={(v) => update("redisUrl", v)}
                className="w-80 font-mono text-xs"
              />
            </FieldRow>
            <FieldRow
              label="Qdrant"
              description="Vector store for embeddings"
            >
              <TextInput
                value={settings.qdrantUrl}
                onChange={(v) => update("qdrantUrl", v)}
                className="w-80 font-mono text-xs"
              />
            </FieldRow>
          </SettingSection>
        </div>
      )}

      {activeTab === "appearance" && (
        <div className="space-y-4 animate-in fade-in">
          <SettingSection
            title="Theme"
            description="Visual appearance settings"
            icon={Palette}
            iconColor="text-pink-400"
          >
            <FieldRow label="Theme" description="Color scheme preference">
              <SelectInput
                value={settings.theme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
                onChange={(v) =>
                  update("theme", v as "dark" | "light" | "system")
                }
              />
            </FieldRow>
            <FieldRow
              label="Compact Mode"
              description="Reduce spacing in the UI"
            >
              <Toggle
                value={settings.compactMode}
                onChange={(v) => update("compactMode", v)}
              />
            </FieldRow>
            <FieldRow
              label="Show Token Counts"
              description="Display token usage in cards and lists"
            >
              <Toggle
                value={settings.showTokenCounts}
                onChange={(v) => update("showTokenCounts", v)}
              />
            </FieldRow>
          </SettingSection>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="space-y-4 animate-in fade-in">
          <SettingSection
            title="Notifications"
            description="Configure when and how you receive alerts"
            icon={Bell}
            iconColor="text-violet-400"
          >
            <FieldRow
              label="On Run Complete"
              description="Notify when a pipeline run finishes"
            >
              <Toggle
                value={settings.notifyOnComplete}
                onChange={(v) => update("notifyOnComplete", v)}
              />
            </FieldRow>
            <FieldRow
              label="On Error"
              description="Notify when an error occurs"
            >
              <Toggle
                value={settings.notifyOnError}
                onChange={(v) => update("notifyOnError", v)}
              />
            </FieldRow>
          </SettingSection>
        </div>
      )}

      {activeTab === "advanced" && (
        <div className="space-y-4 animate-in fade-in">
          <SettingSection
            title="Developer Options"
            description="Advanced settings for development and debugging"
            icon={Terminal}
            iconColor="text-amber-400"
          >
            <FieldRow
              label="Debug Mode"
              description="Enable verbose logging and debug panels"
            >
              <Toggle
                value={settings.debugMode}
                onChange={(v) => update("debugMode", v)}
              />
            </FieldRow>
            <FieldRow
              label="Telemetry"
              description="Anonymous usage analytics"
            >
              <Toggle
                value={settings.telemetry}
                onChange={(v) => update("telemetry", v)}
              />
            </FieldRow>
            <FieldRow label="Log Level" description="Minimum log severity">
              <SelectInput
                value={settings.logLevel}
                options={[
                  { value: "debug", label: "Debug" },
                  { value: "info", label: "Info" },
                  { value: "warn", label: "Warn" },
                  { value: "error", label: "Error" },
                ]}
                onChange={(v) => update("logLevel", v)}
              />
            </FieldRow>
          </SettingSection>
        </div>
      )}
    </div>
  );
}
