// ============================================
// Recipe System
// ============================================
// Built-in recipes: reusable pipeline templates
// that can be instantiated with parameters.
//
// A Recipe describes a pipeline graph (nodes + wires)
// as a serializable template. Users can instantiate
// a recipe to create a concrete PipelineOrchestrator
// with all nodes connected and ready to run.

import { nanoid } from "nanoid";
import type {
  Recipe,
  RecipeParameter,
  PipelineConfig,
  SerializedNode,
  Wire,
  Signal,
  RunInput,
} from "../types/pipeline.js";
import { PipelineOrchestrator, type PipelineOptions } from "../engine/pipeline.js";
import { createNode } from "./registry.js";
import {
  scopeToolRegistry,
  toolPolicyFromConfig,
  resolveBrain,
  isToolRegistry,
  type ProviderFactory,
} from "../engine/capability-resolver.js";
import { selectStaticSkills, composeSkills } from "../skills/index.js";
import type { Skill } from "../skills/types.js";
import type { LLMProvider } from "../types/llm.js";
import type { MemoryStore } from "../types/storage.js";
import { recordingProvider, type RoleRef } from "../engine/recorder.js";
import { loadBuiltinTopologies } from "../formats/builtin.js";
import { asTopology } from "../formats/derive.js";
import type { Topology } from "../formats/model.js";
import { createConsultTool, withTools } from "../engine/consult.js";
import { usesRealAdvisor, withAdvisorTool } from "../engine/advisor-tool.js";
import type { AgentTool, ToolRegistry } from "../types/tools.js";
import { ShellTool, type ShellApprover } from "../tools/shell.js";
import { reportingTools } from "../engine/tool-events.js";
import type { StepInput } from "../types/step.js";

/** Normalize a recipe `skills` param (SkillRegistry instance or Skill[]) to a list. */
function resolveSkillSource(source: unknown): Skill[] {
  if (Array.isArray(source)) return source as Skill[];
  if (
    source &&
    typeof (source as { list?: () => Skill[] }).list === "function"
  ) {
    return (source as { list: () => Skill[] }).list();
  }
  return [];
}

// -----------------------------------------------------------
// Recipe registry
// -----------------------------------------------------------

const recipeRegistry = new Map<string, Topology>();
let builtinsLoaded = false;

/** Load the built-in topologies once, ahead of anything registered before them. */
function ensureBuiltins(): void {
  if (builtinsLoaded) return;
  builtinsLoaded = true;
  const registered = [...recipeRegistry.entries()];
  recipeRegistry.clear();
  for (const t of loadBuiltinTopologies()) recipeRegistry.set(t.id, t);
  for (const [id, t] of registered) recipeRegistry.set(id, t);
}

/**
 * Register a topology. A recipe without a drawing gets one derived from its
 * wires (formats/derive.ts).
 */
export function registerRecipe(recipe: Recipe | Topology): void {
  ensureBuiltins();
  recipeRegistry.set(recipe.id, asTopology(recipe));
}

/**
 * Get a topology by ID.
 */
export function getRecipe(id: string): Topology | undefined {
  ensureBuiltins();
  return recipeRegistry.get(id);
}

/**
 * List all registered topologies, the built-in ones first.
 */
export function listRecipes(): Topology[] {
  ensureBuiltins();
  return Array.from(recipeRegistry.values());
}

/**
 * Instantiate a recipe into a PipelineOrchestrator.
 *
 * @param recipeId The recipe ID
 * @param params Parameters required by the recipe
 * @param overrides Optional overrides for pipeline config
 * @returns A ready-to-run PipelineOrchestrator
 */
export function instantiateRecipe(
  recipeId: string,
  params: Record<string, unknown>,
  overrides?: Partial<PipelineConfig>,
): PipelineOrchestrator {
  ensureBuiltins();
  const recipe = recipeRegistry.get(recipeId);
  if (!recipe) {
    throw new Error(
      `Recipe not found: "${recipeId}". Available: ${Array.from(recipeRegistry.keys()).join(", ")}`,
    );
  }

  return instantiateRecipeFromDefinition(recipe, params, overrides);
}

/**
 * Instantiate a pipeline from a recipe definition.
 */
export function instantiateRecipeFromDefinition(
  recipe: Recipe,
  params: Record<string, unknown>,
  overrides?: Partial<PipelineConfig>,
): PipelineOrchestrator {
  // Validate required parameters
  if (recipe.parameters) {
    for (const param of recipe.parameters) {
      if (param.required && !(param.name in params)) {
        throw new Error(
          `Recipe "${recipe.name}" requires parameter "${param.name}": ${param.description}`,
        );
      }
    }
  }

  // Resolve parameters with defaults
  const resolvedParams: Record<string, unknown> = {};
  if (recipe.parameters) {
    for (const param of recipe.parameters) {
      resolvedParams[param.name] = params[param.name] ?? param.default;
    }
  }
  // Include extra params not in the recipe definition
  for (const [key, value] of Object.entries(params)) {
    if (!(key in resolvedParams)) {
      resolvedParams[key] = value;
    }
  }

  // Build pipeline config. Recipes run in rounds: the drawn order, once per
  // round, with ways back starting the next one.
  const pipelineConfig: PipelineConfig = {
    id: nanoid(12),
    name: recipe.name,
    description: recipe.description,
    workingDir: (resolvedParams.workingDir as string) || process.cwd(),
    maxCycles: 50,
    delayMs: 100,
    schedule: "rounds",
    tags: recipe.tags,
    ...recipe.defaults,
    ...overrides,
  };
  // The ways back the definition draws all leave from one role: that role decides each round.
  const decider = (recipe as Partial<Topology>).waysBack?.[0]?.from;
  if (decider && pipelineConfig.decider === undefined) pipelineConfig.decider = decider;
  if (pipelineConfig.repeat && !pipelineConfig.repeat.planFile) {
    pipelineConfig.repeat = {
      ...pipelineConfig.repeat,
      planFile: (resolvedParams.planFile as string) || "PLAN.md",
    };
  }

  const pipeline = new PipelineOrchestrator(pipelineConfig, {
    memory: resolvedParams.memory as MemoryStore | undefined,
    seedShared: resolvedParams.seedShared as Record<string, unknown> | undefined,
    run: {
      task: typeof resolvedParams.task === "string" ? resolvedParams.task : undefined,
      inputs: Array.isArray(resolvedParams.inputs) ? (resolvedParams.inputs as RunInput[]) : undefined,
    },
    // Not `checks`: that name is the Evaluation loop's own legacy config.
    checks: resolvedParams.measuredChecks as PipelineOptions["checks"],
    memoryPrefix: resolvedParams.memoryPrefix as string[] | null | undefined,
  });

  // Session-level skills are attached (manually) to every node in the pipeline
  // — this is how an AgentSession applies skills auto-activated for the task.
  const sessionSkills = Array.isArray(resolvedParams.sessionSkills)
    ? (resolvedParams.sessionSkills as string[])
    : [];

  // Optional provider factory for resolving per-node brains.
  const providerFactory = resolvedParams.providerFactory as
    | ProviderFactory
    | undefined;

  // Optional skills source (SkillRegistry or Skill[]) for attaching skills.
  const allSkills = resolveSkillSource(resolvedParams.skills);

  // Create and add nodes
  for (const serialized of recipe.nodes) {
    const nodeConfig = {
      ...serialized.config,
    };

    // Merge resolved params into node metadata; the definition's name is the role's name.
    const metadata: Record<string, unknown> = {
      ...serialized.metadata,
      ...resolvedParams,
      nodeName: serialized.name,
    };

    // Per-node tool availability: start from the node's allow/deny policy
    // (or legacy enabledTools).
    let policy = toolPolicyFromConfig(nodeConfig);

    // Attached skills grant tools: any skill statically active on this node
    // (always + manual) adds its allowedTools to the node's allow-list.
    if (allSkills.length > 0) {
      const manualSkills = [...(nodeConfig.skills ?? []), ...sessionSkills];
      const composed = composeSkills(selectStaticSkills(allSkills, manualSkills));
      if (composed.allowedTools.length > 0 && policy?.allow) {
        policy = {
          ...policy,
          allow: [...new Set([...policy.allow, ...composed.allowedTools])],
        };
      }
      if (composed.systemPrompt) {
        // Expose the composed skill instructions for nodes/loops to inject.
        metadata.skillPrompt = composed.systemPrompt;
      }
    }

    // Scope the global toolkit to the (possibly skill-augmented) policy.
    if (policy && isToolRegistry(metadata.tools)) {
      metadata.tools = scopeToolRegistry(metadata.tools, policy);
    }
    // A role that names its shell programs gets a shell that runs only those.
    const shell = isToolRegistry(metadata.tools) ? metadata.tools.get("shell") : undefined;
    if (policy?.commands && shell instanceof ShellTool) {
      metadata.tools = withTools(metadata.tools as ToolRegistry, [shell.withCommands(policy.commands)]);
    }
    // In a session someone watches, a program off the role's list is put to them.
    const approve = resolvedParams.approve as ShellApprover | undefined;
    const roleShell = isToolRegistry(metadata.tools) ? metadata.tools.get("shell") : undefined;
    if (approve && roleShell instanceof ShellTool) {
      metadata.tools = withTools(metadata.tools as ToolRegistry, [
        roleShell.withApprover((request) => approve({ ...request, role: serialized.id, roleName: serialized.name })),
      ]);
    }

    // Per-node brain: if the node declares its own model and a provider
    // factory is available, give it a dedicated provider. Otherwise the
    // pipeline default is kept.
    if (nodeConfig.brain && metadata.provider) {
      metadata.provider = resolveBrain(
        nodeConfig.brain,
        metadata.provider as LLMProvider,
        providerFactory,
      );
    }

    // A caller may give a role its own provider (a replay, a sight probe).
    const roleProvider = resolvedParams.roleProvider as ((role: RoleRef) => LLMProvider | undefined) | undefined;
    const own = roleProvider?.({
      id: serialized.id,
      name: serialized.name,
      category: serialized.category,
      type: serialized.type,
    });
    if (own) metadata.provider = own;

    // A consult edge from this role: Anthropic's own advisor tool when the caller runs
    // on Anthropic and the edge shows the whole transcript; else a tool the lab runs.
    const consults = ((recipe as Partial<Topology>).consults ?? []).filter((c) => c.from === serialized.id);
    const consultTools: AgentTool[] = [];
    for (const edge of consults) {
      if (!resolvedParams.provider) break;
      const caller = metadata.provider as LLMProvider | undefined;
      if (caller && usesRealAdvisor(caller, edge)) {
        metadata.provider = withAdvisorTool(caller, edge, (results, model) => {
          for (const r of results) {
            const inputs: StepInput[] = [
              { source: "run", name: "transcript", from: serialized.id, provenance: "written", value: { seen: "the caller's whole transcript, as the provider sends it to the advisor", model } },
            ];
            const handle = pipeline.beginConsult(edge, serialized.id, inputs, undefined, true);
            pipeline.endConsult(
              handle,
              edge,
              serialized.id,
              {
                ...(r.kind === "text" ? { advice: r.text ?? "" } : {}),
                ...(r.kind === "sealed" ? { sealed: true } : {}),
                ...(r.kind === "error" ? { error: `the advisor tool returned ${r.errorCode}` } : {}),
                usage: r.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              },
              true,
            );
          }
        });
        continue;
      }
      const base =
        roleProvider?.({ id: edge.role.id, name: edge.role.name, category: "custom", type: "advisor" }) ??
        resolveBrain(edge.role.brain, resolvedParams.provider as LLMProvider, providerFactory);
      consultTools.push(
        createConsultTool({
          edge,
          callerId: serialized.id,
          provider: recordingProvider(base, (call) => pipeline.recordCall(edge.role.id, call)),
          task: typeof resolvedParams.task === "string" ? resolvedParams.task : undefined,
          host: {
            begin: (e, caller, inputs, question) => pipeline.beginConsult(e, caller, inputs, question),
            end: (handle, e, caller, outcome) => pipeline.endConsult(handle, e, caller, outcome),
            measure: (label, signal) => pipeline.measureNow(label, signal),
          },
        }),
      );
    }
    if (consultTools.length > 0) {
      metadata.tools = withTools(isToolRegistry(metadata.tools) ? metadata.tools : undefined, consultTools);
    }

    // Each tool run is reported as it starts and as it ends.
    if (isToolRegistry(metadata.tools)) {
      metadata.tools = reportingTools(metadata.tools, (run) => pipeline.recordTool(serialized.id, run));
    }
    // Every model call a role makes is recorded on its step; its text is handed on as it comes when the session asks.
    if (metadata.provider) {
      metadata.provider = recordingProvider(
        metadata.provider as LLMProvider,
        (call) => pipeline.recordCall(serialized.id, call),
        resolvedParams.streamText ? (delta) => pipeline.recordText(serialized.id, delta) : undefined,
      );
    }

    const node = createNode(
      serialized.type,
      serialized.id,
      nodeConfig,
      metadata,
      serialized.ports,
    );
    pipeline.addNode(node);
  }

  // Create wires (carrying any declarative feedback spec and field list through to the engine)
  for (const wireDef of recipe.wires) {
    pipeline.connect(wireDef.sourcePortId, wireDef.targetPortId, {
      id: wireDef.id,
      feedback: wireDef.feedback,
      fields: wireDef.fields,
    });
  }

  return pipeline;
}

// -----------------------------------------------------------
// Built-in topologies
// -----------------------------------------------------------
// They are definition files (packages/core/topologies), read through the
// formats module the first time the registry is used.

// -----------------------------------------------------------
// Utility: Create recipe from a running pipeline
// -----------------------------------------------------------

/**
 * Serialize a running pipeline into a Recipe.
 * Useful for "save as recipe" functionality in the dashboard.
 */
export function pipelineToRecipe(
  pipeline: PipelineOrchestrator,
  meta: {
    name: string;
    description: string;
    author?: string;
    tags?: string[];
    category?: string;
    parameters?: RecipeParameter[];
  },
): Recipe {
  const graph = pipeline.getGraph();

  const nodes: SerializedNode[] = graph.nodes.map((n) => {
    const node = pipeline.getNode(n.id)!;
    return node.serialize();
  });

  const wires = graph.wires.map((w) => ({
    id: w.id,
    sourcePortId: w.sourcePortId,
    targetPortId: w.targetPortId,
    enabled: w.enabled,
    feedback: w.feedback,
    ...(w.fields ? { fields: w.fields } : {}),
  }));

  const now = new Date().toISOString();

  return {
    id: nanoid(12),
    name: meta.name,
    description: meta.description,
    version: "1.0.0",
    author: meta.author,
    tags: meta.tags || [],
    category: meta.category,
    nodes,
    wires,
    defaults: {},
    parameters: meta.parameters,
    createdAt: now,
    updatedAt: now,
  };
}
