// ============================================
// Provider Factory
// ============================================

import type { LLMProvider, LLMProviderConfig } from '../types/llm.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

/** Map of provider name → constructor */
const PROVIDERS: Record<string, new (config: LLMProviderConfig) => LLMProvider> = {
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  // OpenRouter uses OpenAI-compatible API
  openrouter: OpenAIProvider,
};

/**
 * Create an LLM provider instance by name.
 *
 * @example
 * ```ts
 * const provider = createProvider('ollama', { model: 'llama3.1' });
 * const provider = createProvider('openai', { model: 'gpt-4o', apiKey: '...' });
 * const provider = createProvider('anthropic', { model: 'claude-sonnet-4-20250514', apiKey: '...' });
 * const provider = createProvider('openrouter', {
 *   model: 'anthropic/claude-sonnet-4-20250514',
 *   apiKey: '...',
 *   baseUrl: 'https://openrouter.ai/api/v1',
 * });
 * ```
 */
export function createProvider(name: string, config: LLMProviderConfig): LLMProvider {
  const Provider = PROVIDERS[name.toLowerCase()];
  if (!Provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(
      `Unknown provider "${name}". Available providers: ${available}`
    );
  }
  return new Provider(config);
}

/** Get the list of available provider names */
export function getAvailableProviders(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * Register a custom provider.
 * Use this to add new providers without modifying core code.
 *
 * @example
 * ```ts
 * registerProvider('my-custom', MyCustomProvider);
 * const provider = createProvider('my-custom', { model: 'my-model' });
 * ```
 */
export function registerProvider(
  name: string,
  ProviderClass: new (config: LLMProviderConfig) => LLMProvider
): void {
  PROVIDERS[name.toLowerCase()] = ProviderClass;
}
