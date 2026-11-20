// ============================================
// Composable Loop Engine — Public API
// ============================================

// --- Base ---
export { BaseRoleEngine } from "./base.js";

// --- Specialized Loops ---
export { ExecutionEngine, type ExecutionEngineConfig } from "./execution.js";
export { EvaluationEngine, type EvaluationEngineConfig, type EvaluationCheck, type EvaluationVerdict } from "./evaluation.js";
export { PlanningEngine, type PlanningEngineConfig, type StrategyDecision } from "./planning.js";
export { CriticEngine, type CriticEngineConfig, type InterventionType } from "./critic.js";
export { MemoryEngine, type MemoryEngineConfig } from "./memory.js";
export {
  RefinementEngine,
  type RefinementEngineConfig,
  type RefinementAction,
  type RefinementDecision,
} from "./refinement.js";

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
