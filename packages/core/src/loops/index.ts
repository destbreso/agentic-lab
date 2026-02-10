// ============================================
// Composable Loop Engine — Public API
// ============================================

// --- Base ---
export { BaseLoopNode } from "./base.js";

// --- Specialized Loops ---
export { ExecutionLoop, type ExecutionLoopConfig } from "./execution.js";
export { EvaluationLoop, type EvaluationLoopConfig, type EvaluationCheck, type EvaluationVerdict } from "./evaluation.js";
export { PlanningLoop, type PlanningLoopConfig, type StrategyDecision } from "./planning.js";
export { CriticLoop, type CriticLoopConfig, type InterventionType } from "./critic.js";
export { MemoryLoop, type MemoryLoopConfig } from "./memory.js";

// --- Registry ---
export {
  registerNodeType,
  getNodeType,
  listNodeTypes,
  createNode,
} from "./registry.js";

// --- Recipes ---
export {
  registerRecipe,
  getRecipe,
  listRecipes,
  instantiateRecipe,
  instantiateRecipeFromDefinition,
  pipelineToRecipe,
} from "./recipes.js";
