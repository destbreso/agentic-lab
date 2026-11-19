// ============================================
// The guided first run: a cloud key or a server's address, when no model is found
// ============================================
// Called from the picker the session opens when Jig finds no model at all.
// A key is typed hidden and kept in the OS keychain, never in a file; a
// server's address is asked, then told apart (Ollama answers /api/tags, an
// OpenAI-compatible server /v1/models) before it is written to the person's
// config. A server the person types may be on another machine: that is
// their choice, made by hand, which discovery never makes.

import { saveEntry, storeInKeychain } from "../providers.js";
import type { SessionController } from "./controller.js";

const CLOUD = [
  { value: "anthropic", label: "Anthropic", detail: "Claude" },
  { value: "openai", label: "OpenAI", detail: "GPT" },
  { value: "gemini", label: "Gemini", detail: "Google" },
  { value: "openrouter", label: "OpenRouter", detail: "many providers through one key" },
];

export async function addKey(ctrl: SessionController): Promise<void> {
  const kind = await ctrl.pickOne("Which provider is the key for?", CLOUD);
  if (!kind) return;
  const key = await ctrl.askSecret(`${kind}'s key: type or paste it, it is not shown`);
  if (!key) return ctrl.info([[["  no key: nothing was saved", "dim"]]], "getting a model");
  try {
    storeInKeychain(kind, key);
    saveEntry({ name: kind, kind, key: "keychain" });
  } catch (e) {
    return ctrl.say("error", `${(e as Error).message}. A key can also live in an environment variable: /providers add ${kind} --key env:NAME`);
  }
  ctrl.info([[[`  ${kind} saved: its key is in your keychain, and your config says where to find it`, "ink"]]], "getting a model");
  await ctrl.reload();
}

/** What kind of server answers at an address, and the base URL its entry uses; null when nothing answers as a model server. */
export async function probeServer(address: string, fetchImpl: typeof fetch = fetch): Promise<{ kind: "ollama" | "openai-compatible"; baseUrl: string; models: number } | null> {
  const root = (/^[a-z]+:\/\//i.test(address) ? address : `http://${address}`).replace(/\/+$/, "").replace(/\/v1$/, "");
  const get = async (url: string) => {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const tags = await get(`${root}/api/tags`);
  if (tags && Array.isArray(tags.models)) return { kind: "ollama", baseUrl: root, models: tags.models.length };
  const v1 = await get(`${root}/v1/models`);
  if (v1 && Array.isArray(v1.data)) return { kind: "openai-compatible", baseUrl: `${root}/v1`, models: v1.data.length };
  return null;
}

export async function addServer(ctrl: SessionController): Promise<void> {
  const address = await ctrl.askText("The server's address, like http://192.168.1.20:11434 or localhost:1234");
  if (!address?.trim()) return;
  const found = await probeServer(address.trim());
  if (!found) return ctrl.say("error", `nothing at ${address.trim()} answered as a model server (it asked /api/tags and /v1/models)`);
  const host = new URL(found.baseUrl).hostname;
  const name = found.kind === "ollama" ? (["localhost", "127.0.0.1"].includes(host) ? "ollama" : `ollama-${host.replace(/[^a-z0-9]+/gi, "-")}`) : `server-${host.replace(/[^a-z0-9]+/gi, "-")}`;
  saveEntry({ name, kind: found.kind, baseUrl: found.baseUrl });
  ctrl.info([[[`  ${name} saved: ${found.baseUrl}, ${found.models} model${found.models === 1 ? "" : "s"}`, "ink"]]], "getting a model");
  await ctrl.reload();
}
