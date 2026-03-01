// ============================================
// OpenAI Provider — Unit Tests (non-network)
// ============================================
// Tests for inferProviderName and constructor logic.
// Does NOT require a real API key or network access.

import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";

// Mock the openai module to avoid needing a real API key
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      constructor(_config: unknown) {}
      chat = { completions: { create: vi.fn() } };
    },
  };
});

describe("OpenAIProvider", () => {
  describe("inferProviderName", () => {
    it("defaults to 'openai' with no baseUrl", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        model: "gpt-4",
      });
      expect(provider.name).toBe("openai");
    });

    it("defaults to 'openai' with standard OpenAI url", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        model: "gpt-4",
        baseUrl: "https://api.openai.com/v1",
      });
      expect(provider.name).toBe("openai");
    });

    it("detects openrouter from baseUrl", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        model: "gpt-4",
        baseUrl: "https://openrouter.ai/api/v1",
      });
      expect(provider.name).toBe("openrouter");
    });

    it("detects google from googleapis baseUrl", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        model: "gemini-pro",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      });
      expect(provider.name).toBe("google");
    });

    it("uses explicit name from config over inference", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        model: "gpt-4",
        name: "custom-provider",
        baseUrl: "https://openrouter.ai/api/v1",
      });
      expect(provider.name).toBe("custom-provider");
    });
  });

  describe("constructor", () => {
    it("stores model from config", () => {
      const provider = new OpenAIProvider({
        apiKey: "key",
        model: "gpt-4-turbo",
      });
      // Access private field through any
      expect((provider as unknown as { model: string }).model).toBe(
        "gpt-4-turbo",
      );
    });
  });
});
