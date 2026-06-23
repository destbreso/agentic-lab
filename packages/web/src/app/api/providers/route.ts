// ============================================
// GET /api/providers
// ============================================
// Lists LLM providers, their suggested models, and whether they are configured
// (API key present in the environment). Powers the per-node "brain" selector.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  envKey: string | null;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "ollama", name: "Ollama (local)", models: ["llama3.1", "qwen2.5", "mistral", "deepseek-r1"], envKey: null },
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o3-mini"], envKey: "OPENAI_API_KEY" },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-3-5-20241022"],
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o", "google/gemini-2.0-flash-001"],
    envKey: "OPENROUTER_API_KEY",
  },
  { id: "google", name: "Google", models: ["gemini-2.0-flash", "gemini-1.5-pro"], envKey: "GOOGLE_API_KEY" },
];

export async function GET() {
  return NextResponse.json({
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models,
      configured: p.envKey ? Boolean(process.env[p.envKey]) : true,
    })),
    tools: ["file_read", "file_write", "shell", "glob", "grep", "git"],
  });
}
