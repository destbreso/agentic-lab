"use client";

import { useState } from "react";
import {
  BookOpen,
  Play,
  ChevronRight,
  Cpu,
  CheckCircle2,
  Brain,
  Shield,
  Database,
  Copy,
  ExternalLink,
  Tag,
  User,
  Clock,
} from "lucide-react";

// -----------------------------------------------------------
// Recipe data (mirrors the core recipes)
// -----------------------------------------------------------

interface RecipeData {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  category: string;
  nodeCount: number;
  wireCount: number;
  nodes: Array<{ type: string; name: string }>;
  parameters: Array<{
    name: string;
    description: string;
    type: string;
    required: boolean;
    default?: string;
  }>;
}

const RECIPES: RecipeData[] = [
  {
    id: "ralph-loop",
    name: "Ralph Loop",
    description:
      "Classic single-loop agent. Read specs → pick task → work → commit. The original, simple, effective.",
    version: "1.0.0",
    author: "Agentic Lab",
    tags: ["classic", "simple", "beginner"],
    category: "basic",
    nodeCount: 1,
    wireCount: 0,
    nodes: [{ type: "execution", name: "Ralph Executor" }],
    parameters: [
      {
        name: "provider",
        description: "LLM provider instance",
        type: "string",
        required: true,
      },
      {
        name: "tools",
        description: "Tool registry",
        type: "string",
        required: true,
      },
      {
        name: "workingDir",
        description: "Working directory for the agent",
        type: "string",
        required: true,
      },
      {
        name: "promptFile",
        description: "Path to the prompt/spec file",
        type: "string",
        required: false,
        default: "PROMPT.md",
      },
      {
        name: "planFile",
        description: "Path to the plan file",
        type: "string",
        required: false,
        default: "PLAN.md",
      },
    ],
  },
  {
    id: "exec-eval",
    name: "Execute & Evaluate",
    description:
      "Two-loop pattern: Execution does work, Evaluation verifies real-world changes. Simple but effective.",
    version: "1.0.0",
    author: "Agentic Lab",
    tags: ["intermediate", "verification"],
    category: "intermediate",
    nodeCount: 2,
    wireCount: 2,
    nodes: [
      { type: "execution", name: "Executor" },
      { type: "evaluation", name: "Evaluator" },
    ],
    parameters: [
      {
        name: "provider",
        description: "LLM provider",
        type: "string",
        required: true,
      },
      {
        name: "tools",
        description: "Tool registry",
        type: "string",
        required: true,
      },
      {
        name: "workingDir",
        description: "Working directory",
        type: "string",
        required: true,
      },
    ],
  },
  {
    id: "full-agent-pipeline",
    name: "Full Agent Pipeline",
    description:
      "Complete agentic pipeline with all 5 specialized loops: Planning → Execution → Evaluation, with Critic watching and Memory compressing.",
    version: "1.0.0",
    author: "Agentic Lab",
    tags: ["advanced", "full", "specialized"],
    category: "advanced",
    nodeCount: 5,
    wireCount: 15,
    nodes: [
      { type: "planning", name: "Strategic Planner" },
      { type: "execution", name: "Task Executor" },
      { type: "evaluation", name: "Output Evaluator" },
      { type: "critic", name: "Anti-Ralph Critic" },
      { type: "memory", name: "Context Compressor" },
    ],
    parameters: [
      {
        name: "provider",
        description: "LLM provider instance for all loops",
        type: "string",
        required: true,
      },
      {
        name: "tools",
        description: "Tool registry shared by execution and evaluation",
        type: "string",
        required: true,
      },
      {
        name: "workingDir",
        description: "Working directory",
        type: "string",
        required: true,
      },
      {
        name: "planFile",
        description: "Path to the plan file",
        type: "string",
        required: false,
        default: "PLAN.md",
      },
      {
        name: "promptFile",
        description: "Path to the prompt/spec file",
        type: "string",
        required: false,
        default: "PROMPT.md",
      },
    ],
  },
];

// -----------------------------------------------------------
// Category helpers
// -----------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  basic: "bg-green-500/10 text-green-400 border-green-500/30",
  intermediate: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  advanced: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  execution: <Cpu className="w-3.5 h-3.5 text-blue-400" />,
  evaluation: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  planning: <Brain className="w-3.5 h-3.5 text-purple-400" />,
  critic: <Shield className="w-3.5 h-3.5 text-orange-400" />,
  memory: <Database className="w-3.5 h-3.5 text-cyan-400" />,
};

// -----------------------------------------------------------
// Page Component
// -----------------------------------------------------------

export default function RecipesPage() {
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeData | null>(null);

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-[var(--primary)]" />
          Recipes
        </h2>
        <p className="text-[var(--muted)] mt-1">
          Plantillas reutilizables de pipelines. Instancia una recipe para crear
          un pipeline listo para ejecutar.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recipe Cards */}
        <div className="lg:col-span-2 space-y-4">
          {RECIPES.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              isSelected={selectedRecipe?.id === recipe.id}
              onSelect={() => setSelectedRecipe(recipe)}
            />
          ))}
        </div>

        {/* Detail Panel */}
        <div className="card">
          {selectedRecipe ? (
            <RecipeDetail recipe={selectedRecipe} />
          ) : (
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 text-[var(--muted)]/30 mx-auto mb-3" />
              <p className="text-[var(--muted)] text-sm">
                Selecciona una recipe para ver los detalles
              </p>
            </div>
          )}
        </div>
      </div>

      {/* How Recipes Work */}
      <section className="card">
        <h3 className="text-lg font-semibold mb-4">
          📖 Cómo funcionan las Recipes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StepCard
            number="1"
            title="Selecciona"
            description="Elige una recipe que se ajuste a tu caso de uso — desde el simple Ralph Loop hasta el pipeline completo"
            color="blue"
          />
          <StepCard
            number="2"
            title="Configura"
            description="Proporciona los parámetros requeridos: proveedor LLM, herramientas, directorio de trabajo"
            color="green"
          />
          <StepCard
            number="3"
            title="Ejecuta"
            description="La recipe crea un pipeline con todos los nodos conectados y listo para correr"
            color="purple"
          />
        </div>
        <div className="mt-4 p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)]">
          <p className="text-xs text-[var(--muted)]">
            <strong className="text-[var(--foreground)]">CLI:</strong>{" "}
            <code className="text-blue-400">
              agentic-lab run --recipe full-agent-pipeline --provider ollama
              --model llama3.1
            </code>
          </p>
        </div>
      </section>
    </div>
  );
}

// -----------------------------------------------------------
// Sub-components
// -----------------------------------------------------------

function RecipeCard({
  recipe,
  isSelected,
  onSelect,
}: {
  recipe: RecipeData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`card cursor-pointer transition-all hover:scale-[1.01] ${
        isSelected
          ? "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-semibold text-lg">{recipe.name}</h3>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider ${
                CATEGORY_COLORS[recipe.category] || CATEGORY_COLORS.basic
              }`}
            >
              {recipe.category}
            </span>
            <span className="text-xs text-[var(--muted)]">
              v{recipe.version}
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">{recipe.description}</p>
        </div>
        <ChevronRight
          className={`w-5 h-5 text-[var(--muted)] transition-transform ${
            isSelected ? "rotate-90 text-[var(--primary)]" : ""
          }`}
        />
      </div>

      {/* Node preview */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {recipe.nodes.map((node, i) => (
          <div key={i} className="flex items-center">
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--background)] border border-[var(--card-border)] text-xs">
              {NODE_TYPE_ICONS[node.type]}
              <span>{node.name}</span>
            </span>
            {i < recipe.nodes.length - 1 && (
              <ChevronRight className="w-3 h-3 text-[var(--muted)]/40 mx-1" />
            )}
          </div>
        ))}
      </div>

      {/* Tags */}
      <div className="flex items-center gap-2 mt-3">
        {recipe.tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--background)] text-[10px] text-[var(--muted)]"
          >
            <Tag className="w-2.5 h-2.5" />
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecipeDetail({ recipe }: { recipe: RecipeData }) {
  return (
    <div className="space-y-5">
      <div>
        <h4 className="font-semibold text-lg">{recipe.name}</h4>
        <p className="text-xs text-[var(--muted)] mt-1">{recipe.description}</p>
      </div>

      {/* Meta */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 text-[var(--muted)]">
          <User className="w-3.5 h-3.5" />
          <span>{recipe.author}</span>
        </div>
        <div className="flex items-center gap-2 text-[var(--muted)]">
          <Clock className="w-3.5 h-3.5" />
          <span>v{recipe.version}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-[var(--background)] border border-[var(--card-border)] text-center">
          <p className="text-lg font-bold">{recipe.nodeCount}</p>
          <p className="text-[10px] text-[var(--muted)]">Nodos</p>
        </div>
        <div className="p-2 rounded bg-[var(--background)] border border-[var(--card-border)] text-center">
          <p className="text-lg font-bold">{recipe.wireCount}</p>
          <p className="text-[10px] text-[var(--muted)]">Conexiones</p>
        </div>
      </div>

      {/* Parameters */}
      <div>
        <h5 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
          Parámetros
        </h5>
        <div className="space-y-1.5">
          {recipe.parameters.map((param) => (
            <div
              key={param.name}
              className="p-2 rounded bg-[var(--background)] border border-[var(--card-border)] text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{param.name}</span>
                {param.required ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30">
                    requerido
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400">
                    opcional
                  </span>
                )}
              </div>
              <p className="text-[var(--muted)] mt-0.5">{param.description}</p>
              {param.default && (
                <p className="text-blue-400 mt-0.5">
                  default: <code>{param.default}</code>
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg transition-colors text-sm font-medium">
          <Play className="w-4 h-4" />
          Instanciar Pipeline
        </button>
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--background)] border border-[var(--card-border)] hover:border-[var(--primary)] text-[var(--muted)] rounded-lg transition-colors text-sm">
          <Copy className="w-4 h-4" />
          Duplicar Recipe
        </button>
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--background)] border border-[var(--card-border)] hover:border-[var(--primary)] text-[var(--muted)] rounded-lg transition-colors text-sm">
          <ExternalLink className="w-4 h-4" />
          Ver en Pipeline Builder
        </button>
      </div>
    </div>
  );
}

function StepCard({
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
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    green: "bg-green-500/10 text-green-400 border-green-500/30",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  };

  return (
    <div
      className={`p-4 rounded-lg border ${colorClasses[color] || colorClasses.blue}`}
    >
      <div className="text-2xl font-bold mb-1">{number}</div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-xs opacity-80">{description}</p>
    </div>
  );
}
