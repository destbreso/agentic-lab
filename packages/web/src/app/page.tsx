import { Activity, Cpu, Zap, Clock, BarChart3, GitBranch } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section>
        <h2 className="text-3xl font-bold mb-2">Dashboard</h2>
        <p className="text-[var(--muted)]">
          Monitor your agentic loops, analyze performance, and manage experiments.
        </p>
      </section>

      {/* Quick Stats */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="w-5 h-5 text-blue-400" />}
          label="Total Runs"
          value="—"
          subtext="No runs yet"
        />
        <StatCard
          icon={<Zap className="w-5 h-5 text-yellow-400" />}
          label="Total Tokens"
          value="—"
          subtext="Across all runs"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-green-400" />}
          label="Avg Duration"
          value="—"
          subtext="Per iteration"
        />
        <StatCard
          icon={<Cpu className="w-5 h-5 text-purple-400" />}
          label="Providers"
          value="—"
          subtext="Configured"
        />
      </section>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Runs */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Recent Runs
            </h3>
          </div>
          <div className="text-[var(--muted)] text-center py-12">
            <p className="mb-2">No runs recorded yet.</p>
            <p className="text-sm">
              Use the CLI to start your first agentic loop:
            </p>
            <code className="mt-2 inline-block px-3 py-1.5 bg-[var(--background)] rounded text-sm font-mono">
              agentic-lab run --provider ollama --model llama3.1
            </code>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Quick Start
          </h3>
          <div className="space-y-3">
            <QuickAction
              title="Initialize Workspace"
              description="Create PROMPT.md, PLAN.md, and specs/"
              command="agentic-lab init"
            />
            <QuickAction
              title="Run with Ollama"
              description="Start a loop using local LLM"
              command="agentic-lab run -p ollama -m llama3.1"
            />
            <QuickAction
              title="Run with OpenAI"
              description="Start a loop using GPT-4o"
              command="agentic-lab run -p openai -m gpt-4o"
            />
            <QuickAction
              title="Run with Anthropic"
              description="Start a loop using Claude"
              command="agentic-lab run -p anthropic"
            />
            <QuickAction
              title="Check Providers"
              description="Test all configured LLM providers"
              command="agentic-lab providers --test"
            />
          </div>
        </div>
      </div>

      {/* Architecture Overview */}
      <section className="card">
        <h3 className="text-lg font-semibold mb-4">🏗️ The Agentic Loop Pattern</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
          <PillarCard
            number="1"
            title="Specs"
            description="What to build — project requirements and constraints"
            color="blue"
          />
          <PillarCard
            number="2"
            title="Plan"
            description="Living TODO — agent reads, picks a task, updates progress"
            color="green"
          />
          <PillarCard
            number="3"
            title="Prompt"
            description="Static instructions — how to behave each iteration"
            color="purple"
          />
          <PillarCard
            number="4"
            title="Brain + Muscle"
            description="LLM (brain) + Tools (muscle) — execute the work"
            color="orange"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-[var(--muted)] mt-1">{subtext}</p>
    </div>
  );
}

function QuickAction({
  title,
  description,
  command,
}: {
  title: string;
  description: string;
  command: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)] hover:border-[var(--primary)] transition-colors">
      <p className="font-medium text-sm">{title}</p>
      <p className="text-xs text-[var(--muted)] mb-1.5">{description}</p>
      <code className="text-xs font-mono text-blue-400">{command}</code>
    </div>
  );
}

function PillarCard({
  number,
  title,
  description,
  color,
}: {
  number: string;
  title: string;
  description: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  };

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color] || colorClasses.blue}`}>
      <div className="text-2xl font-bold mb-1">{number}</div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-xs opacity-80">{description}</p>
    </div>
  );
}
