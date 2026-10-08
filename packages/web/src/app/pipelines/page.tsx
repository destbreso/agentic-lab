"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Zap,
  Eye,
  Brain,
  Shield,
  Database,
  Plus,
  Trash2,
  Play,
  Save,
  GripVertical,
  X,
  ChevronRight,
  Settings2,
  Plug,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Square,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CapabilityEditor,
  type ProviderInfo,
  type SkillInfo,
} from "./capability-panel";
import {
  WireInspector,
  normalizeFeedback,
  type WireFeedback,
} from "./wire-inspector";

type RunStatus = "running" | "done" | "error";

/* ─── Types ──────────────────────────────────────── */

interface Port {
  name: string;
  signalTypes: string[];
  required?: boolean;
}

interface NodeType {
  type: string;
  name: string;
  category: string;
  description: string;
  ports: { inputs: Port[]; outputs: Port[] };
  defaultConfig: Record<string, unknown>;
}

interface PipelineNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  /** Per-node ports override (from recipe definitions). Falls back to nodeType ports when absent. */
  ports?: { inputs: Port[]; outputs: Port[] };
}

interface Wire {
  id: string;
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
  /** Optional declarative feedback rule (condition / re-type / cap). */
  feedback?: WireFeedback;
}

interface WiringState {
  fromNodeId: string;
  fromPort: string;
  fromType: "output";
}

/* ─── Constants ──────────────────────────────────── */

const LOOP_META: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; borderColor: string }
> = {
  execution: {
    icon: Zap,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  evaluation: {
    icon: Eye,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
  },
  planning: {
    icon: Brain,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
  },
  critic: {
    icon: Shield,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
  },
  memory: {
    icon: Database,
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
  },
};

/* ─── Palette Item (Draggable) ───────────────────── */

function PaletteItem({ nodeType }: { nodeType: NodeType }) {
  const meta = LOOP_META[nodeType.type] || LOOP_META.execution;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${nodeType.type}`,
    data: { nodeType, source: "palette" },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex cursor-grab items-center gap-3 rounded-xl border p-3 transition-all active:cursor-grabbing",
        meta.borderColor,
        isDragging ? "opacity-40 scale-95" : "hover:bg-zinc-800/50",
      )}
    >
      <div className={cn("rounded-lg p-2", meta.bg)}>
        <meta.icon className={cn("h-4 w-4", meta.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200 truncate">
          {nodeType.name}
        </p>
        <p className="text-[10px] text-zinc-500 truncate">
          {nodeType.description}
        </p>
      </div>
      <GripVertical className="h-4 w-4 shrink-0 text-zinc-600" />
    </div>
  );
}

/* ─── Canvas Node ────────────────────────────────── */

function CanvasNode({
  node,
  nodeType,
  selected,
  onSelect,
  onDelete,
  wiringState,
  onStartWire,
  onCompleteWire,
  onMove,
  runStatus,
}: {
  node: PipelineNode;
  nodeType?: NodeType;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  wiringState: WiringState | null;
  onStartWire: (nodeId: string, port: string) => void;
  onCompleteWire: (nodeId: string, port: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  runStatus?: RunStatus;
}) {
  const meta = LOOP_META[node.type] || LOOP_META.execution;
  const Icon = meta.icon;
  // Use per-node ports (recipe-specific) first, then generic nodeType ports
  const ports = node.ports || nodeType?.ports || { inputs: [], outputs: [] };

  // Node dragging
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-port]")) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX - node.x,
      startY: e.clientY - node.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const nx = ev.clientX - dragRef.current.startX;
      const ny = ev.clientY - dragRef.current.startY;
      onMove(node.id, nx, ny);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      className={cn(
        "absolute select-none rounded-xl border-2 bg-zinc-900/90 backdrop-blur-sm shadow-xl transition-shadow",
        selected && !runStatus
          ? "ring-2 ring-blue-500/50 " + meta.borderColor
          : meta.borderColor,
        runStatus === "running" && "ring-2 ring-amber-400/80 animate-pulse",
        runStatus === "done" && "ring-2 ring-emerald-500/70",
        runStatus === "error" && "ring-2 ring-red-500/80",
        "hover:shadow-2xl",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: 240,
        zIndex: selected ? 20 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-[10px] border-b px-3 py-2",
          meta.borderColor,
          meta.bg,
        )}
      >
        <Icon className={cn("h-4 w-4", meta.color)} />
        <span className="flex-1 text-xs font-semibold text-zinc-100 truncate">
          {node.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Ports */}
      <div className="flex">
        {/* Input ports */}
        <div className="flex-1 space-y-1 p-2">
          <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-zinc-600">
            Inputs
          </p>
          {ports.inputs.map((p) => {
            const canConnect =
              wiringState !== null && wiringState.fromNodeId !== node.id;
            return (
              <button
                key={p.name}
                data-port="input"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canConnect) onCompleteWire(node.id, p.name);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10px] transition-colors",
                  canConnect
                    ? "bg-emerald-500/10 text-emerald-300 cursor-pointer hover:bg-emerald-500/20"
                    : "text-zinc-500 cursor-default",
                )}
              >
                <div
                  className={cn(
                    "h-2 w-2 rounded-full border",
                    canConnect
                      ? "border-emerald-400 bg-emerald-400/30"
                      : p.required
                        ? "border-zinc-500 bg-zinc-700"
                        : "border-zinc-600 bg-zinc-800",
                  )}
                />
                <span className="truncate">{p.name}</span>
                {p.required && (
                  <span className="text-[8px] text-amber-500">*</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px bg-zinc-800" />

        {/* Output ports */}
        <div className="flex-1 space-y-1 p-2">
          <p className="mb-1 text-[9px] font-medium uppercase tracking-widest text-zinc-600">
            Outputs
          </p>
          {ports.outputs.map((p) => (
            <button
              key={p.name}
              data-port="output"
              onClick={(e) => {
                e.stopPropagation();
                if (!wiringState) onStartWire(node.id, p.name);
              }}
              className={cn(
                "flex w-full items-center justify-end gap-1.5 rounded-md px-1.5 py-1 text-right text-[10px] transition-colors",
                wiringState
                  ? "text-zinc-600 cursor-default"
                  : "text-zinc-400 cursor-pointer hover:bg-blue-500/10 hover:text-blue-300",
              )}
            >
              <span className="truncate">{p.name}</span>
              <div
                className={cn(
                  "h-2 w-2 rounded-full border",
                  wiringState
                    ? "border-zinc-600 bg-zinc-800"
                    : "border-blue-400 bg-blue-400/30",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── SVG Wires ──────────────────────────────────── */

/** Short summary of a wire's feedback rule, for the mid-wire badge. */
function feedbackLabel(fb?: WireFeedback): string | null {
  if (!fb) return null;
  const parts: string[] = [];
  if (fb.whenSignal) parts.push(`?${fb.whenSignal}`);
  if (fb.where?.length) parts.push(`⛒${fb.where.length}`);
  if (fb.asSignal) parts.push(`→${fb.asSignal}`);
  if (fb.maxFires != null) parts.push(`×${fb.maxFires}`);
  if (fb.set && Object.keys(fb.set).length) parts.push(`+${Object.keys(fb.set).length}`);
  return parts.length ? parts.join(" ") : "ƒ";
}

function WiresSVG({
  wires,
  nodes,
  nodeTypes,
  selectedWireId,
  onSelectWire,
}: {
  wires: Wire[];
  nodes: PipelineNode[];
  nodeTypes: NodeType[];
  selectedWireId: string | null;
  onSelectWire: (id: string) => void;
}) {
  const getPortPosition = (
    nodeId: string,
    portName: string,
    type: "input" | "output",
  ): { x: number; y: number } | null => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    // Use per-node ports first (from recipe), fall back to generic nodeType
    const nt = nodeTypes.find((t) => t.type === node.type);
    const nodePorts = node.ports || nt?.ports;
    if (!nodePorts) return null;

    const ports = type === "input" ? nodePorts.inputs : nodePorts.outputs;
    const idx = ports.findIndex((p) => p.name === portName);
    if (idx < 0) return null;

    const nodeWidth = 240;
    const headerHeight = 36;
    const labelHeight = 16;
    const portSpacing = 22;

    return {
      x: type === "input" ? node.x : node.x + nodeWidth,
      y: node.y + headerHeight + labelHeight + idx * portSpacing + 12,
    };
  };

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <marker
          id="wire-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" fillOpacity="0.6" />
        </marker>
        <marker
          id="wire-arrow-fb"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" fillOpacity="0.7" />
        </marker>
      </defs>
      {wires.map((w) => {
        const from = getPortPosition(w.from.nodeId, w.from.port, "output");
        const to = getPortPosition(w.to.nodeId, w.to.port, "input");
        if (!from || !to) return null;

        const dx = Math.abs(to.x - from.x) * 0.5;
        const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
        const hasFeedback = Boolean(w.feedback);
        const selected = selectedWireId === w.id;
        const color = hasFeedback ? "#f59e0b" : "#3b82f6";
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const badge = hasFeedback ? feedbackLabel(w.feedback) : null;

        return (
          <g key={w.id} className="pointer-events-auto cursor-pointer">
            {/* Fat invisible hit area for easy selection */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              onClick={(e) => {
                e.stopPropagation();
                onSelectWire(w.id);
              }}
            />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={selected ? 3 : 2}
              strokeOpacity={selected ? 0.6 : 0.3}
              markerEnd={hasFeedback ? "url(#wire-arrow-fb)" : "url(#wire-arrow)"}
              className="pointer-events-none"
            />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeOpacity={selected ? 1 : 0.6}
              strokeDasharray="6 4"
              className="wire-flow pointer-events-none"
            />
            {badge && (
              <g className="pointer-events-none">
                <rect
                  x={mid.x - badge.length * 3.4 - 6}
                  y={mid.y - 9}
                  width={badge.length * 6.8 + 12}
                  height={18}
                  rx={9}
                  fill="#18181b"
                  stroke={selected ? "#f59e0b" : "#f59e0b80"}
                  strokeWidth={selected ? 1.5 : 1}
                />
                <text
                  x={mid.x}
                  y={mid.y + 3}
                  textAnchor="middle"
                  className="fill-amber-300"
                  style={{ fontSize: "10px", fontFamily: "monospace", fontWeight: 600 }}
                >
                  {badge}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Config Panel ───────────────────────────────── */

function ConfigPanel({
  node,
  nodeType,
  onClose,
  onUpdate,
  providers,
  skills,
  tools,
}: {
  node: PipelineNode;
  nodeType?: NodeType;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<PipelineNode>) => void;
  providers: ProviderInfo[];
  skills: SkillInfo[];
  tools: string[];
}) {
  const meta = LOOP_META[node.type] || LOOP_META.execution;

  return (
    <div className="flex w-80 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-200">
            Node Config
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Node identity */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Name
          </label>
          <input
            type="text"
            value={node.name}
            onChange={(e) => onUpdate(node.id, { name: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            Type
          </label>
          <Badge variant="outline" className={cn(meta.color, "text-xs")}>
            {node.type}
          </Badge>
        </div>

        {nodeType?.description && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Description
            </label>
            <p className="text-xs text-zinc-400">{nodeType.description}</p>
          </div>
        )}

        {/* Capabilities */}
        <CapabilityEditor
          config={node.config || {}}
          category={node.type}
          providers={providers}
          skills={skills}
          tools={tools}
          onChange={(config) => onUpdate(node.id, { config })}
        />

        {/* Ports info */}
        {(node.ports || nodeType?.ports) && (
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-500">
              Ports
            </label>
            <div className="space-y-1">
              {(node.ports || nodeType?.ports)?.inputs.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <Plug className="h-3 w-3 text-emerald-500" />
                  <span className="text-zinc-400">{p.name}</span>
                  {p.required && (
                    <span className="text-amber-500">(required)</span>
                  )}
                </div>
              ))}
              {(node.ports || nodeType?.ports)?.outputs.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <Plug className="h-3 w-3 rotate-180 text-blue-500" />
                  <span className="text-zinc-400">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="border-t border-zinc-800 p-4">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => {
            onUpdate(node.id, {} as Partial<PipelineNode>);
            onClose();
          }}
        >
          <Trash2 className="mr-2 h-3 w-3" />
          Delete Node
        </Button>
      </div>
    </div>
  );
}

/* ─── Main Pipelines Page ────────────────────────── */

interface RecipeWireDef {
  fromNode: number;
  fromPort: string;
  toNode: number;
  toPort: string;
  feedback?: WireFeedback;
}

interface RecipeNodeDef {
  id?: string;
  type: string;
  name: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
  ports?: { inputs: Port[]; outputs: Port[] };
}

interface RecipeData {
  id: string;
  name: string;
  nodes: RecipeNodeDef[];
  wires: RecipeWireDef[];
}

function PipelinesPageInner() {
  const searchParams = useSearchParams();
  const recipeParam = searchParams.get("recipe");

  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [wiringState, setWiringState] = useState<WiringState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [loadingRecipe, setLoadingRecipe] = useState(!!recipeParam);
  const [loadedRecipeName, setLoadedRecipeName] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const recipeLoaded = useRef(false);

  // Capability data + run state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [runConfig, setRunConfig] = useState({
    provider: "ollama",
    model: "llama3.1",
    task: "",
  });
  const [running, setRunning] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<Record<string, RunStatus>>({});
  const [runLog, setRunLog] = useState<{ kind: "info" | "ok" | "error"; text: string }[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [saving, setSaving] = useState(false);
  const runAbort = useRef<AbortController | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Load node types
  useEffect(() => {
    fetch("/api/pipelines/node-types")
      .then((r) => r.json())
      .then((d) => setNodeTypes(d.nodeTypes || []))
      .catch(() => {});
  }, []);

  // Load providers, tools and skills for the capability editor
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => {
        setProviders(d.providers || []);
        setTools(d.tools || []);
      })
      .catch(() => {});
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []))
      .catch(() => {});
  }, []);

  // Load recipe from query param: ?recipe=exec-eval
  useEffect(() => {
    if (!recipeParam || recipeLoaded.current || nodeTypes.length === 0) return;
    recipeLoaded.current = true;
    setLoadingRecipe(true);

    fetch("/api/pipelines/recipes")
      .then((r) => r.json())
      .then((d) => {
        const recipe = (d.recipes || []).find(
          (r: RecipeData) => r.id === recipeParam,
        );
        if (!recipe || !recipe.nodes) {
          setLoadingRecipe(false);
          return;
        }

        // Create pipeline nodes from recipe definition
        const newNodes: PipelineNode[] = recipe.nodes.map(
          (rn: RecipeNodeDef, i: number) => {
            const nt = nodeTypes.find((n) => n.type === rn.type);
            return {
              id: `recipe-node-${i}-${Date.now()}`,
              type: rn.type,
              name: rn.name || nt?.name || rn.type,
              x: rn.x ?? 100 + i * 300,
              y: rn.y ?? 150,
              config: { ...(nt?.defaultConfig || {}), ...(rn.config || {}) },
              // Prefer recipe per-node ports over generic nodeType ports
              ports: rn.ports || nt?.ports,
            };
          },
        );

        // Create wires from recipe wire definitions
        const newWires: Wire[] = (recipe.wires || [])
          .filter(
            (rw: RecipeWireDef) =>
              rw.fromNode < newNodes.length && rw.toNode < newNodes.length,
          )
          .map((rw: RecipeWireDef, i: number) => ({
            id: `recipe-wire-${i}-${Date.now()}`,
            from: { nodeId: newNodes[rw.fromNode].id, port: rw.fromPort },
            to: { nodeId: newNodes[rw.toNode].id, port: rw.toPort },
            feedback: rw.feedback,
          }));

        setNodes(newNodes);
        setWires(newWires);
        setLoadedRecipeName(recipe.name);
        setLoadingRecipe(false);
      })
      .catch(() => setLoadingRecipe(false));
  }, [recipeParam, nodeTypes]);

  // Generate unique ID
  const nextId = () => {
    idCounter.current += 1;
    return `node-${Date.now()}-${idCounter.current}`;
  };

  // Add node to canvas
  const addNode = useCallback(
    (type: string, x: number, y: number) => {
      const nt = nodeTypes.find((n) => n.type === type);
      if (!nt) return;
      const newNode: PipelineNode = {
        id: nextId(),
        type,
        name: nt.name,
        x,
        y,
        config: { ...nt.defaultConfig },
      };
      setNodes((prev) => [...prev, newNode]);
    },
    [nodeTypes],
  );

  // Move node
  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  // Update node
  const updateNode = useCallback(
    (id: string, updates: Partial<PipelineNode>) => {
      if (Object.keys(updates).length === 0) {
        // Delete
        setNodes((prev) => prev.filter((n) => n.id !== id));
        setWires((prev) =>
          prev.filter((w) => w.from.nodeId !== id && w.to.nodeId !== id),
        );
        setSelectedNodeId(null);
        return;
      }
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      );
    },
    [],
  );

  // Delete node
  const deleteNode = useCallback(
    (id: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setWires((prev) =>
        prev.filter((w) => w.from.nodeId !== id && w.to.nodeId !== id),
      );
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [selectedNodeId],
  );

  // Wiring
  const startWire = useCallback((nodeId: string, port: string) => {
    setWiringState({ fromNodeId: nodeId, fromPort: port, fromType: "output" });
  }, []);

  const completeWire = useCallback(
    (toNodeId: string, toPort: string) => {
      if (!wiringState) return;
      // Prevent self-connection and duplicates
      if (wiringState.fromNodeId === toNodeId) {
        setWiringState(null);
        return;
      }
      const exists = wires.some(
        (w) =>
          w.from.nodeId === wiringState.fromNodeId &&
          w.from.port === wiringState.fromPort &&
          w.to.nodeId === toNodeId &&
          w.to.port === toPort,
      );
      if (!exists) {
        setWires((prev) => [
          ...prev,
          {
            id: `wire-${Date.now()}`,
            from: {
              nodeId: wiringState.fromNodeId,
              port: wiringState.fromPort,
            },
            to: { nodeId: toNodeId, port: toPort },
          },
        ]);
      }
      setWiringState(null);
    },
    [wiringState, wires],
  );

  // Cancel wiring + clear selection on canvas click
  const handleCanvasClick = useCallback(() => {
    setWiringState(null);
    setSelectedNodeId(null);
    setSelectedWireId(null);
  }, []);

  // Select a node (clears any wire selection — panels are mutually exclusive)
  const selectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedWireId(null);
  }, []);

  // Select a wire (clears node selection + any in-progress wiring)
  const selectWire = useCallback((id: string) => {
    setSelectedWireId(id);
    setSelectedNodeId(null);
    setWiringState(null);
  }, []);

  // Update a wire's feedback rule (normalized: an empty rule clears it)
  const updateWireFeedback = useCallback((id: string, fb: WireFeedback) => {
    const normalized = normalizeFeedback(fb);
    setWires((prev) =>
      prev.map((w) => (w.id === id ? { ...w, feedback: normalized } : w)),
    );
  }, []);

  // Delete a wire
  const deleteWire = useCallback(
    (id: string) => {
      setWires((prev) => prev.filter((w) => w.id !== id));
      setSelectedWireId((cur) => (cur === id ? null : cur));
    },
    [],
  );

  const log = useCallback(
    (kind: "info" | "ok" | "error", text: string) =>
      setRunLog((p) => [...p.slice(-200), { kind, text }]),
    [],
  );

  // Run the pipeline currently on the canvas, streaming live status to nodes.
  const handleRun = useCallback(async () => {
    if (nodes.length === 0 || running) return;
    setRunning(true);
    setNodeStatus({});
    setRunLog([]);
    setShowLog(true);
    const controller = new AbortController();
    runAbort.current = controller;
    const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

    try {
      const res = await fetch("/api/pipelines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            name: n.name,
            x: n.x,
            y: n.y,
            config: n.config,
          })),
          wires: wires.map((w) => ({ from: w.from, to: w.to, feedback: w.feedback })),
          provider: runConfig.provider,
          model: runConfig.model,
          task: runConfig.task || undefined,
          maxCycles: 10,
        }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        log("error", e.error || `HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          const id = ev.nodeId as string;
          switch (ev.event) {
            case "pipeline:start":
              log("info", "▶ Pipeline started");
              break;
            case "cycle:start":
              log("info", `Cycle ${ev.cycle}`);
              break;
            case "node:start":
              setNodeStatus((s) => ({ ...s, [id]: "running" }));
              break;
            case "node:end":
              setNodeStatus((s) => ({ ...s, [id]: ev.success ? "done" : "error" }));
              log("ok", `✓ ${nameOf(id)} — ${ev.tokens} tok, ${ev.toolCalls} tools`);
              break;
            case "node:error":
              setNodeStatus((s) => ({ ...s, [id]: "error" }));
              log("error", `✗ ${nameOf(id)}: ${ev.error}`);
              break;
            case "signal":
              log("info", `↳ ${ev.type} from ${nameOf(ev.from as string)}`);
              break;
            case "complete":
              log(ev.success ? "ok" : "error", `■ Done — ${ev.cycles} cycles · ${ev.tokens} tokens`);
              break;
            case "error":
              log("error", `Error: ${ev.error}`);
              break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") log("error", (e as Error).message);
    } finally {
      setRunning(false);
      runAbort.current = null;
    }
  }, [nodes, wires, running, runConfig, log]);

  const stopRun = useCallback(() => {
    runAbort.current?.abort();
    setRunning(false);
    log("info", "■ Stopped by user");
  }, [log]);

  // Save the current canvas as a reusable pipeline.
  const handleSave = useCallback(async () => {
    if (nodes.length === 0 || saving) return;
    const name = window.prompt("Pipeline name", loadedRecipeName ?? "My Pipeline");
    if (!name) return;
    setSaving(true);
    const idx = (id: string) => nodes.findIndex((n) => n.id === id);
    try {
      const res = await fetch("/api/pipelines/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            name: n.name,
            x: n.x,
            y: n.y,
            config: n.config,
            ports: n.ports,
          })),
          wires: wires.map((w) => ({
            fromNode: idx(w.from.nodeId),
            fromPort: w.from.port,
            toNode: idx(w.to.nodeId),
            toPort: w.to.port,
            feedback: w.feedback,
          })),
        }),
      });
      if (res.ok) {
        setLoadedRecipeName(name);
        setShowLog(true);
        log("ok", `Saved pipeline "${name}"`);
      } else {
        const e = await res.json().catch(() => ({}));
        log("error", `Save failed: ${e.error || res.status}`);
        setShowLog(true);
      }
    } catch (e) {
      log("error", `Save failed: ${(e as Error).message}`);
      setShowLog(true);
    } finally {
      setSaving(false);
    }
  }, [nodes, wires, saving, loadedRecipeName, log]);

  // DnD handlers
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active.data.current) return;

      const data = active.data.current as {
        nodeType: NodeType;
        source: string;
      };
      if (data.source === "palette") {
        // Dropped on canvas — calculate position
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (!canvasRect) return;

        // Use the pointer position from the event
        const x = Math.max(
          20,
          (event.activatorEvent as PointerEvent)?.clientX - canvasRect.left ||
            100,
        );
        const y = Math.max(
          20,
          (event.activatorEvent as PointerEvent)?.clientY - canvasRect.top ||
            100,
        );

        addNode(data.nodeType.type, x, y);
      }
    },
    [addNode],
  );

  const { setNodeRef: setCanvasDropRef } = useDroppable({ id: "canvas" });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeType = selectedNode
    ? nodeTypes.find((t) => t.type === selectedNode.type)
    : undefined;

  // Selected wire + endpoint context (labels + signal types) for the inspector.
  const selectedWire = wires.find((w) => w.id === selectedWireId);
  const wireCtx = (() => {
    if (!selectedWire) return null;
    const fromNode = nodes.find((n) => n.id === selectedWire.from.nodeId);
    const toNode = nodes.find((n) => n.id === selectedWire.to.nodeId);
    const portsOf = (n?: PipelineNode) =>
      n ? n.ports ?? nodeTypes.find((t) => t.type === n.type)?.ports : undefined;
    const srcPort = portsOf(fromNode)?.outputs.find((p) => p.name === selectedWire.from.port);
    const tgtPort = portsOf(toNode)?.inputs.find((p) => p.name === selectedWire.to.port);
    return {
      fromLabel: `${fromNode?.name ?? selectedWire.from.nodeId} · ${selectedWire.from.port}`,
      toLabel: `${toNode?.name ?? selectedWire.to.nodeId} · ${selectedWire.to.port}`,
      sourceSignalTypes: srcPort?.signalTypes ?? [],
      targetSignalTypes: tgtPort?.signalTypes ?? [],
    };
  })();

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full animate-in fade-in">
        {/* Palette */}
        <div
          className={cn(
            "flex flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200",
            paletteOpen ? "w-72" : "w-0 overflow-hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-200">
              Node Palette
            </h2>
            <button
              onClick={() => setPaletteOpen(false)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-600 mb-2">
              Drag to canvas
            </p>
            {nodeTypes.map((nt) => (
              <PaletteItem key={nt.type} nodeType={nt} />
            ))}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex flex-1 flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 backdrop-blur">
            {!paletteOpen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaletteOpen(true)}
              >
                <Plus className="mr-1 h-3 w-3" />
                Nodes
              </Button>
            )}
            {loadedRecipeName && (
              <Badge
                variant="outline"
                className="text-[10px] text-violet-300 border-violet-500/30 bg-violet-500/5"
              >
                Recipe: {loadedRecipeName}
              </Badge>
            )}
            <div className="flex-1" />
            <Badge variant="muted" className="text-[10px]">
              {nodes.length} node{nodes.length !== 1 ? "s" : ""} ·{" "}
              {wires.length} wire{wires.length !== 1 ? "s" : ""}
            </Badge>
            {wiringState && (
              <Badge variant="warning" className="text-[10px] animate-pulse">
                <Plug className="mr-1 h-3 w-3" />
                Connecting… click an input port
              </Badge>
            )}
            <div className="h-4 w-px bg-zinc-700" />
            {/* Run config */}
            <input
              value={runConfig.task}
              onChange={(e) => setRunConfig((c) => ({ ...c, task: e.target.value }))}
              placeholder="Task / objective (optional)"
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50"
            />
            <select
              value={runConfig.provider}
              onChange={(e) => setRunConfig((c) => ({ ...c, provider: e.target.value }))}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-xs text-zinc-200 outline-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.configured ? "" : " (no key)"}
                </option>
              ))}
              {providers.length === 0 && <option value="ollama">Ollama</option>}
            </select>
            <input
              list="run-models"
              value={runConfig.model}
              onChange={(e) => setRunConfig((c) => ({ ...c, model: e.target.value }))}
              placeholder="model"
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50"
            />
            <datalist id="run-models">
              {(providers.find((p) => p.id === runConfig.provider)?.models ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              onClick={() => setShowLog((s) => !s)}
              className={cn(
                "rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                showLog && "bg-zinc-800 text-zinc-200",
              )}
              title="Toggle run log"
            >
              <Terminal className="h-4 w-4" />
            </button>
            <Button
              variant="ghost"
              size="sm"
              disabled={nodes.length === 0 || saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Save className="mr-1 h-3 w-3" />
              )}
              Save
            </Button>
            {running ? (
              <Button variant="destructive" size="sm" onClick={stopRun}>
                <Square className="mr-1 h-3 w-3" />
                Stop
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={nodes.length === 0}
                onClick={handleRun}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Play className="mr-1 h-3 w-3" />
                Run
              </Button>
            )}
          </div>

          {/* Canvas */}
          <div
            ref={(el) => {
              canvasRef.current = el;
              setCanvasDropRef(el);
            }}
            className="pipeline-grid relative flex-1 overflow-auto"
            onClick={handleCanvasClick}
          >
            {nodes.length === 0 && !loadingRecipe && (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="rounded-2xl bg-zinc-800/40 p-6">
                    <Plus className="h-8 w-8 text-zinc-600" />
                  </div>
                  <p className="text-sm font-medium text-zinc-400">
                    Drag nodes from the palette
                  </p>
                  <p className="max-w-xs text-xs text-zinc-600">
                    Build your multi-loop pipeline by dragging loop nodes onto
                    the canvas and connecting their ports with wires.
                  </p>
                </div>
              </div>
            )}

            {loadingRecipe && (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                  <p className="text-sm font-medium text-zinc-300">
                    Loading recipe…
                  </p>
                </div>
              </div>
            )}

            <WiresSVG
              wires={wires}
              nodes={nodes}
              nodeTypes={nodeTypes}
              selectedWireId={selectedWireId}
              onSelectWire={selectWire}
            />

            {nodes.map((node) => (
              <CanvasNode
                key={node.id}
                node={node}
                nodeType={nodeTypes.find((t) => t.type === node.type)}
                selected={selectedNodeId === node.id}
                onSelect={() => selectNode(node.id)}
                onDelete={() => deleteNode(node.id)}
                wiringState={wiringState}
                onStartWire={startWire}
                onCompleteWire={completeWire}
                onMove={moveNode}
                runStatus={nodeStatus[node.id]}
              />
            ))}
          </div>

          {/* Run log */}
          {showLog && (
            <div className="flex h-44 flex-col border-t border-zinc-800 bg-zinc-950">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
                <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-300">Run log</span>
                {running && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> running
                  </span>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => setRunLog([])}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  clear
                </button>
                <button
                  onClick={() => setShowLog(false)}
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
                {runLog.length === 0 ? (
                  <p className="text-zinc-600">No events yet. Press Run to execute the pipeline.</p>
                ) : (
                  runLog.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-1.5",
                        l.kind === "ok" && "text-emerald-400",
                        l.kind === "error" && "text-red-400",
                        l.kind === "info" && "text-zinc-400",
                      )}
                    >
                      {l.kind === "ok" && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
                      {l.kind === "error" && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                      <span className="whitespace-pre-wrap break-words">{l.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Config Panel (node) */}
        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            nodeType={selectedNodeType}
            onClose={() => setSelectedNodeId(null)}
            onUpdate={updateNode}
            providers={providers}
            skills={skills}
            tools={tools}
          />
        )}

        {/* Wire Inspector (feedback rules) */}
        {selectedWire && wireCtx && (
          <WireInspector
            key={selectedWire.id}
            fromLabel={wireCtx.fromLabel}
            toLabel={wireCtx.toLabel}
            sourceSignalTypes={wireCtx.sourceSignalTypes}
            targetSignalTypes={wireCtx.targetSignalTypes}
            feedback={selectedWire.feedback ?? {}}
            onChange={(fb) => updateWireFeedback(selectedWire.id, fb)}
            onDelete={() => deleteWire(selectedWire.id)}
            onClose={() => setSelectedWireId(null)}
          />
        )}
      </div>
    </DndContext>
  );
}

export default function PipelinesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      <PipelinesPageInner />
    </Suspense>
  );
}
