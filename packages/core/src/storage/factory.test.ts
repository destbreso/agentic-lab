// ============================================
// Storage factory — embedding resolution
// ============================================

import { describe, it, expect } from "vitest";
import { resolveEmbedding } from "./factory.js";

describe("resolveEmbedding", () => {
  it("defaults to local Ollama with nomic-embed-text (768 dims)", () => {
    const e = resolveEmbedding({});
    expect([e.provider, e.model, e.dimension]).toEqual(["ollama", "nomic-embed-text", 768]);
  });

  it("picks OpenAI when only an OpenAI key is set", () => {
    const e = resolveEmbedding({ OPENAI_API_KEY: "sk-test" });
    expect([e.provider, e.model, e.dimension]).toEqual(["openai", "text-embedding-3-small", 1536]);
  });

  it("honors EMBEDDING_PROVIDER over the presence of an OpenAI key, as .env.example sets it", () => {
    const e = resolveEmbedding({
      OPENAI_API_KEY: "sk-test",
      EMBEDDING_PROVIDER: "ollama",
      EMBEDDING_MODEL: "nomic-embed-text",
    });
    expect([e.provider, e.model, e.dimension]).toEqual(["ollama", "nomic-embed-text", 768]);
  });

  it("keeps OLLAMA_EMBEDDING_MODEL working and ignores the tag when looking up the size", () => {
    const e = resolveEmbedding({ OLLAMA_EMBEDDING_MODEL: "nomic-embed-text:latest" });
    expect([e.model, e.dimension]).toEqual(["nomic-embed-text:latest", 768]);
  });

  it("leaves the size to the store for an unknown model, unless EMBEDDING_DIMENSION says", () => {
    expect(resolveEmbedding({ EMBEDDING_MODEL: "mystery-embed" }).dimension).toBeUndefined();
    expect(resolveEmbedding({ EMBEDDING_MODEL: "mystery-embed", EMBEDDING_DIMENSION: "1024" }).dimension).toBe(1024);
  });

  it("rejects OpenAI without a key and providers it does not know", () => {
    expect(() => resolveEmbedding({ EMBEDDING_PROVIDER: "openai" })).toThrow(/needs OPENAI_API_KEY/);
    expect(() => resolveEmbedding({ EMBEDDING_PROVIDER: "cohere" })).toThrow(/unknown EMBEDDING_PROVIDER/);
  });
});
