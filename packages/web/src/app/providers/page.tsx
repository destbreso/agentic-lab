export default function ProvidersPage() {
  const providers = [
    {
      name: 'Ollama',
      icon: '🦙',
      description: 'Local LLM inference. Free, private, no API key needed.',
      models: ['llama3.1', 'codellama', 'mistral', 'deepseek-coder-v2', 'qwen2.5'],
      setup: 'Install Ollama: brew install ollama && ollama serve',
      envVars: ['OLLAMA_BASE_URL', 'OLLAMA_DEFAULT_MODEL'],
    },
    {
      name: 'OpenAI',
      icon: '🟢',
      description: 'GPT models. Powerful reasoning and tool use.',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview'],
      setup: 'Set OPENAI_API_KEY in .env',
      envVars: ['OPENAI_API_KEY', 'OPENAI_DEFAULT_MODEL', 'OPENAI_BASE_URL'],
    },
    {
      name: 'Anthropic',
      icon: '🟠',
      description: 'Claude models. Excellent at following complex instructions.',
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-5-20241022'],
      setup: 'Set ANTHROPIC_API_KEY in .env',
      envVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_DEFAULT_MODEL'],
    },
    {
      name: 'OpenRouter',
      icon: '🌐',
      description: 'Unified gateway to 100+ models from multiple providers.',
      models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-4o', 'meta-llama/llama-3.1-70b'],
      setup: 'Set OPENROUTER_API_KEY in .env',
      envVars: ['OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_DEFAULT_MODEL'],
    },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-3xl font-bold mb-2">Providers</h2>
        <p className="text-[var(--muted)]">
          Configure and manage your LLM providers.
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {providers.map((provider) => (
          <div key={provider.name} className="card">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{provider.icon}</span>
              <div>
                <h3 className="text-lg font-semibold">{provider.name}</h3>
                <p className="text-xs text-[var(--muted)]">{provider.description}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-[var(--muted)] uppercase mb-1">
                  Available Models
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {provider.models.map((model) => (
                    <span
                      key={model}
                      className="px-2 py-0.5 bg-[var(--background)] rounded text-xs font-mono"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--muted)] uppercase mb-1">
                  Environment Variables
                </p>
                <div className="space-y-0.5">
                  {provider.envVars.map((v) => (
                    <code
                      key={v}
                      className="block text-xs font-mono text-blue-400"
                    >
                      {v}
                    </code>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--card-border)]">
                <p className="text-xs text-[var(--muted)]">
                  Setup: <span className="font-mono">{provider.setup}</span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
