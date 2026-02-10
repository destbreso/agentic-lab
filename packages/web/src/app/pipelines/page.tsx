'use client';

import { useState } from 'react';
import {
  Network,
  Plus,
  Play,
  Pause,
  Square,
  Settings2,
  Trash2,
  ArrowRight,
  Cpu,
  CheckCircle2,
  Brain,
  Shield,
  Database,
  Puzzle,
} from 'lucide-react';

// -----------------------------------------------------------
// Types (matching core pipeline types for the UI)
// -----------------------------------------------------------

interface UINode {
  id: string;
  type: string;
  name: string;
  category: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  position: { x: number; y: number };
  inputPorts: Array<{ name: string; signalTypes: string[] }>;
  outputPorts: Array<{ name: string; signalTypes: string[] }>;
}

interface UIWire {
  id: string;
  sourceNodeId: string;
  sourcePortName: string;
  targetNodeId: string;
  targetPortName: string;
  enabled: boolean;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  nodes: UINode[];
  wires: UIWire[];
  totalCycles: number;
  totalTokens: number;
  createdAt: string;
}

// -----------------------------------------------------------
// Node category metadata
// -----------------------------------------------------------

const CATEGORY_META: Record<
  string,
  { icon: React.ReactNode; color: string; bgColor: string; borderColor: string }
> = {
  execution: {
    icon: <Cpu className="w-4 h-4" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  evaluation: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
  },
  planning: {
    icon: <Brain className="w-4 h-4" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
  },
  critic: {
    icon: <Shield className="w-4 h-4" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
  },
  memory: {
    icon: <Database className="w-4 h-4" />,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
  },
  custom: {
    icon: <Puzzle className="w-4 h-4" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500/30',
  },
};

// -----------------------------------------------------------
// Sample pipeline (Full Agent Pipeline)
// -----------------------------------------------------------

const SAMPLE_PIPELINE: Pipeline = {
  id: 'demo-full-pipeline',
  name: 'Full Agent Pipeline',
  description:
    'Complete agentic pipeline with all 5 specialized loops connected.',
  status: 'idle',
  nodes: [
    {
      id: 'planner',
      type: 'planning',
      name: 'Strategic Planner',
      category: 'planning',
      status: 'idle',
      position: { x: 50, y: 140 },
      inputPorts: [
        { name: 'evaluation', signalTypes: ['evaluation'] },
        { name: 'critic_feedback', signalTypes: ['critic_feedback'] },
        { name: 'memory', signalTypes: ['memory'] },
      ],
      outputPorts: [
        { name: 'plan', signalTypes: ['plan'] },
        { name: 'strategy', signalTypes: ['strategy'] },
        { name: 'task', signalTypes: ['task'] },
      ],
    },
    {
      id: 'executor',
      type: 'execution',
      name: 'Task Executor',
      category: 'execution',
      status: 'idle',
      position: { x: 330, y: 50 },
      inputPorts: [
        { name: 'task', signalTypes: ['task', 'plan'] },
        { name: 'context', signalTypes: ['context', 'memory'] },
      ],
      outputPorts: [
        { name: 'result', signalTypes: ['execution_result'] },
        { name: 'tool_calls', signalTypes: ['tool_calls'] },
        { name: 'tokens', signalTypes: ['token_usage'] },
      ],
    },
    {
      id: 'evaluator',
      type: 'evaluation',
      name: 'Output Evaluator',
      category: 'evaluation',
      status: 'idle',
      position: { x: 610, y: 50 },
      inputPorts: [
        { name: 'execution_result', signalTypes: ['execution_result'] },
        { name: 'ground_truth', signalTypes: ['ground_truth'] },
      ],
      outputPorts: [
        { name: 'evaluation', signalTypes: ['evaluation'] },
        { name: 'corrections', signalTypes: ['corrections'] },
        { name: 'metrics', signalTypes: ['eval_metrics'] },
      ],
    },
    {
      id: 'critic',
      type: 'critic',
      name: 'Anti-Ralph Critic',
      category: 'critic',
      status: 'idle',
      position: { x: 330, y: 290 },
      inputPorts: [
        { name: 'execution_result', signalTypes: ['execution_result'] },
        { name: 'eval_metrics', signalTypes: ['eval_metrics'] },
        { name: 'token_usage', signalTypes: ['token_usage'] },
      ],
      outputPorts: [
        { name: 'critic_feedback', signalTypes: ['critic_feedback'] },
        { name: 'stagnation_alert', signalTypes: ['stagnation_alert'] },
        { name: 'intervention', signalTypes: ['intervention'] },
      ],
    },
    {
      id: 'memory',
      type: 'memory',
      name: 'Context Compressor',
      category: 'memory',
      status: 'idle',
      position: { x: 610, y: 290 },
      inputPorts: [
        { name: 'execution_result', signalTypes: ['execution_result'] },
        { name: 'evaluation', signalTypes: ['evaluation'] },
        { name: 'strategy', signalTypes: ['strategy'] },
      ],
      outputPorts: [
        { name: 'compressed_context', signalTypes: ['compressed_context'] },
        { name: 'milestone', signalTypes: ['milestone'] },
        { name: 'memory', signalTypes: ['memory'] },
      ],
    },
  ],
  wires: [
    { id: 'w1', sourceNodeId: 'planner', sourcePortName: 'task', targetNodeId: 'executor', targetPortName: 'task', enabled: true },
    { id: 'w2', sourceNodeId: 'executor', sourcePortName: 'result', targetNodeId: 'evaluator', targetPortName: 'execution_result', enabled: true },
    { id: 'w3', sourceNodeId: 'evaluator', sourcePortName: 'evaluation', targetNodeId: 'planner', targetPortName: 'evaluation', enabled: true },
    { id: 'w5', sourceNodeId: 'executor', sourcePortName: 'result', targetNodeId: 'critic', targetPortName: 'execution_result', enabled: true },
    { id: 'w6', sourceNodeId: 'executor', sourcePortName: 'tokens', targetNodeId: 'critic', targetPortName: 'token_usage', enabled: true },
    { id: 'w7', sourceNodeId: 'evaluator', sourcePortName: 'metrics', targetNodeId: 'critic', targetPortName: 'eval_metrics', enabled: true },
    { id: 'w8', sourceNodeId: 'critic', sourcePortName: 'critic_feedback', targetNodeId: 'planner', targetPortName: 'critic_feedback', enabled: true },
    { id: 'w10', sourceNodeId: 'executor', sourcePortName: 'result', targetNodeId: 'memory', targetPortName: 'execution_result', enabled: true },
    { id: 'w11', sourceNodeId: 'evaluator', sourcePortName: 'evaluation', targetNodeId: 'memory', targetPortName: 'evaluation', enabled: true },
    { id: 'w12', sourceNodeId: 'planner', sourcePortName: 'strategy', targetNodeId: 'memory', targetPortName: 'strategy', enabled: true },
    { id: 'w13', sourceNodeId: 'memory', sourcePortName: 'compressed_context', targetNodeId: 'executor', targetPortName: 'context', enabled: true },
    { id: 'w15', sourceNodeId: 'memory', sourcePortName: 'compressed_context', targetNodeId: 'planner', targetPortName: 'memory', enabled: true },
  ],
  totalCycles: 0,
  totalTokens: 0,
  createdAt: new Date().toISOString(),
};

// -----------------------------------------------------------
// Page Component
// -----------------------------------------------------------

export default function PipelinesPage() {
  const [pipelines] = useState<Pipeline[]>([SAMPLE_PIPELINE]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(
    SAMPLE_PIPELINE,
  );
  const [selectedNode, setSelectedNode] = useState<UINode | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Network className="w-8 h-8 text-[var(--primary)]" />
            Pipeline Builder
          </h2>
          <p className="text-[var(--muted)] mt-1">
            Diseña, conecta y ejecuta workflows de loops especializados
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" />
          Nuevo Pipeline
        </button>
      </div>

      {/* Pipeline List */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {pipelines.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelectedPipeline(p);
              setSelectedNode(null);
            }}
            className={`flex-shrink-0 px-4 py-2 rounded-lg border text-sm transition-colors ${
              selectedPipeline?.id === p.id
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                : 'border-[var(--card-border)] bg-[var(--card)] text-[var(--muted)] hover:border-[var(--primary)]/50'
            }`}
          >
            <span className="font-medium">{p.name}</span>
            <span className="ml-2 text-xs opacity-60">{p.nodes.length} nodos</span>
          </button>
        ))}
      </div>

      {selectedPipeline && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Canvas */}
          <div className="lg:col-span-3 card">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--card-border)]">
              <div>
                <h3 className="font-semibold text-lg">{selectedPipeline.name}</h3>
                <p className="text-xs text-[var(--muted)]">
                  {selectedPipeline.description}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <PipelineStatusBadge status={selectedPipeline.status} />
                <button
                  className="p-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                  title="Run Pipeline"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  className="p-2 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                  title="Pause"
                >
                  <Pause className="w-4 h-4" />
                </button>
                <button
                  className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  title="Stop"
                >
                  <Square className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Node Graph Canvas */}
            <div className="relative bg-[var(--background)] rounded-lg border border-[var(--card-border)] min-h-[460px] overflow-hidden">
              {/* Grid pattern */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-10">
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>

              {/* Wires */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {selectedPipeline.wires.map((wire) => {
                  const source = selectedPipeline.nodes.find(
                    (n) => n.id === wire.sourceNodeId,
                  );
                  const target = selectedPipeline.nodes.find(
                    (n) => n.id === wire.targetNodeId,
                  );
                  if (!source || !target) return null;

                  const sx = source.position.x + 210;
                  const sy = source.position.y + 40;
                  const tx = target.position.x;
                  const ty = target.position.y + 40;
                  const mx = (sx + tx) / 2;

                  return (
                    <path
                      key={wire.id}
                      d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`}
                      fill="none"
                      stroke={wire.enabled ? '#3b82f680' : '#4b556380'}
                      strokeWidth="2"
                      strokeDasharray={wire.enabled ? 'none' : '4 4'}
                    />
                  );
                })}
              </svg>

              {/* Nodes */}
              {selectedPipeline.nodes.map((node) => {
                const meta = CATEGORY_META[node.category] || CATEGORY_META.custom;
                return (
                  <div
                    key={node.id}
                    className={`absolute cursor-pointer transition-all rounded-lg border-2 ${meta.bgColor} ${meta.borderColor} ${
                      selectedNode?.id === node.id
                        ? 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)] scale-105'
                        : 'hover:scale-102'
                    }`}
                    style={{
                      left: node.position.x,
                      top: node.position.y,
                      width: 210,
                    }}
                    onClick={() => setSelectedNode(node)}
                  >
                    <div className="px-3 py-2.5">
                      <div className={`flex items-center gap-2 ${meta.color}`}>
                        {meta.icon}
                        <span className="font-semibold text-sm truncate">
                          {node.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
                          {node.category}
                        </span>
                        <NodeStatusDot status={node.status} />
                      </div>
                      {/* Ports preview */}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--card-border)]">
                        <div className="flex gap-1">
                          {node.inputPorts.map((p) => (
                            <div
                              key={p.name}
                              className="w-2.5 h-2.5 rounded-full bg-[var(--muted)]/30 border border-[var(--muted)]/60"
                              title={`In: ${p.name} (${p.signalTypes.join(', ')})`}
                            />
                          ))}
                        </div>
                        <ArrowRight className="w-3 h-3 text-[var(--muted)]/50" />
                        <div className="flex gap-1">
                          {node.outputPorts.map((p) => (
                            <div
                              key={p.name}
                              className={`w-2.5 h-2.5 rounded-full ${meta.bgColor} border ${meta.borderColor}`}
                              title={`Out: ${p.name} (${p.signalTypes.join(', ')})`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pipeline Stats Bar */}
            <div className="flex items-center gap-6 mt-4 text-xs text-[var(--muted)]">
              <span>{selectedPipeline.nodes.length} nodos</span>
              <span>{selectedPipeline.wires.length} conexiones</span>
              <span>{selectedPipeline.totalCycles} ciclos</span>
              <span>{selectedPipeline.totalTokens.toLocaleString()} tokens</span>
            </div>
          </div>

          {/* Right Panel — Node Details */}
          <div className="card">
            {selectedNode ? (
              <NodeDetailPanel node={selectedNode} />
            ) : (
              <NodePalette />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------
// Sub-components
// -----------------------------------------------------------

function NodeDetailPanel({ node }: { node: UINode }) {
  const meta = CATEGORY_META[node.category] || CATEGORY_META.custom;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 ${meta.color}`}>
          {meta.icon}
          <h4 className="font-semibold">{node.name}</h4>
        </div>
        <div className="flex gap-1">
          <button className="p-1.5 rounded hover:bg-[var(--background)] text-[var(--muted)]">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 rounded hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="text-xs text-[var(--muted)]">
        <span
          className={`inline-block px-2 py-0.5 rounded-full ${meta.bgColor} ${meta.color} ${meta.borderColor} border`}
        >
          {node.category}
        </span>
        <span className="ml-2">ID: {node.id}</span>
      </div>

      {/* Input Ports */}
      <div>
        <h5 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
          Puertos de Entrada
        </h5>
        <div className="space-y-1.5">
          {node.inputPorts.map((port) => (
            <div
              key={port.name}
              className="flex items-center gap-2 text-xs p-2 rounded bg-[var(--background)] border border-[var(--card-border)]"
            >
              <div className="w-2 h-2 rounded-full bg-[var(--muted)]/50" />
              <span className="font-medium">{port.name}</span>
              <span className="text-[var(--muted)] ml-auto text-[10px]">
                {port.signalTypes.join(', ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Output Ports */}
      <div>
        <h5 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
          Puertos de Salida
        </h5>
        <div className="space-y-1.5">
          {node.outputPorts.map((port) => (
            <div
              key={port.name}
              className={`flex items-center gap-2 text-xs p-2 rounded ${meta.bgColor} border ${meta.borderColor}`}
            >
              <div className={`w-2 h-2 rounded-full ${meta.color}`} />
              <span className="font-medium">{port.name}</span>
              <span className={`${meta.color} opacity-60 ml-auto text-[10px]`}>
                {port.signalTypes.join(', ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Config */}
      <div>
        <h5 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
          Configuración
        </h5>
        <div className="space-y-2 text-xs">
          <ConfigRow label="Tipo" value={node.type} />
          <ConfigRow label="Estado" value={node.status} />
          <ConfigRow label="Categoría" value={node.category} />
        </div>
      </div>
    </div>
  );
}

function NodePalette() {
  const categories = [
    {
      type: 'execution',
      name: 'Execution Loop',
      description: 'Rápido, stateless — ejecuta tareas con LLM y tools',
    },
    {
      type: 'evaluation',
      name: 'Evaluation Loop',
      description: 'Verifica cambios reales — nunca confía solo en la salida',
    },
    {
      type: 'planning',
      name: 'Planning Loop',
      description: 'Estratégico, revisa estado agregado, ajusta dirección',
    },
    {
      type: 'critic',
      name: 'Critic Loop',
      description: 'Watchdog adversarial — detecta estancamiento y circularidad',
    },
    {
      type: 'memory',
      name: 'Memory Loop',
      description: 'Resume, comprime, elimina ruido del contexto',
    },
  ];

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-sm">🧩 Paleta de Nodos</h4>
      <p className="text-xs text-[var(--muted)]">
        Arrastra un nodo al canvas para agregarlo al pipeline
      </p>
      <div className="space-y-2">
        {categories.map((cat) => {
          const meta = CATEGORY_META[cat.type] || CATEGORY_META.custom;
          return (
            <div
              key={cat.type}
              className={`p-3 rounded-lg border cursor-pointer hover:scale-[1.02] transition-all ${meta.bgColor} ${meta.borderColor}`}
            >
              <div className={`flex items-center gap-2 ${meta.color}`}>
                {meta.icon}
                <span className="font-medium text-sm">{cat.name}</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-1">
                {cat.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    idle: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
    running: 'bg-green-500/10 text-green-400 border-green-500/30',
    paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    completed: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider ${styles[status] || styles.idle}`}
    >
      {status}
    </span>
  );
}

function NodeStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-gray-500',
    running: 'bg-green-500 animate-pulse',
    paused: 'bg-yellow-500',
    completed: 'bg-blue-500',
    failed: 'bg-red-500',
  };

  return (
    <div
      className={`w-2 h-2 rounded-full ${colors[status] || colors.idle}`}
      title={status}
    />
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-2 rounded bg-[var(--background)] border border-[var(--card-border)]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
