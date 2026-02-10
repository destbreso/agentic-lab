export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-3xl font-bold mb-2">Settings</h2>
        <p className="text-[var(--muted)]">
          Configure Agentic Lab defaults and preferences.
        </p>
      </section>

      {/* Loop Defaults */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Loop Defaults</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingField
            label="Default Provider"
            description="LLM provider for new loops"
            value="ollama"
            envVar="DEFAULT_PROVIDER"
          />
          <SettingField
            label="Max Iterations"
            description="Default max iterations per loop"
            value="10"
            envVar="DEFAULT_MAX_ITERATIONS"
          />
          <SettingField
            label="Delay (ms)"
            description="Pause between iterations"
            value="1000"
            envVar="DEFAULT_DELAY_MS"
          />
          <SettingField
            label="Log Level"
            description="Logging verbosity"
            value="info"
            envVar="DEFAULT_LOG_LEVEL"
          />
        </div>
      </div>

      {/* Configuration File */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Configuration File</h3>
        <p className="text-sm text-[var(--muted)] mb-4">
          Create an{' '}
          <code className="px-1 py-0.5 bg-[var(--background)] rounded text-xs">
            agentic-lab.config.json
          </code>{' '}
          file in your project root for project-specific settings:
        </p>
        <pre className="p-4 bg-[var(--background)] rounded-lg text-sm font-mono overflow-x-auto">
{`{
  "loop": {
    "provider": "ollama",
    "model": "llama3.1",
    "maxIterations": 10,
    "delayMs": 1000,
    "promptFile": "PROMPT.md",
    "planFile": "PLAN.md",
    "specsDir": "specs",
    "autoCommit": false,
    "verbose": false
  },
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "defaultModel": "llama3.1"
    }
  },
  "logging": {
    "level": "info"
  }
}`}
        </pre>
      </div>

      {/* Environment Variables */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Environment Variables</h3>
        <p className="text-sm text-[var(--muted)] mb-4">
          Copy{' '}
          <code className="px-1 py-0.5 bg-[var(--background)] rounded text-xs">
            .env.example
          </code>{' '}
          to{' '}
          <code className="px-1 py-0.5 bg-[var(--background)] rounded text-xs">
            .env
          </code>{' '}
          and configure your providers.
        </p>
      </div>
    </div>
  );
}

function SettingField({
  label,
  description,
  value,
  envVar,
}: {
  label: string;
  description: string;
  value: string;
  envVar: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-[var(--background)]">
      <label className="block text-sm font-medium mb-0.5">{label}</label>
      <p className="text-xs text-[var(--muted)] mb-2">{description}</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          defaultValue={value}
          disabled
          className="flex-1 px-3 py-1.5 bg-[var(--card)] border border-[var(--card-border)] rounded text-sm font-mono"
        />
        <code className="text-xs text-blue-400 whitespace-nowrap">{envVar}</code>
      </div>
    </div>
  );
}
