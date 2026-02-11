import { NextResponse } from "next/server";

/**
 * GET /api/pipelines/recipes
 * List all available recipes with full node positions and wire definitions
 * so the pipeline editor can auto-populate the canvas.
 */
export async function GET() {
  const recipes = [
    {
      id: "ralph-loop",
      name: "Ralph Loop",
      description:
        "Classic single-loop agent. Read specs → pick task → work → commit.",
      version: "1.0.0",
      author: "Agentic Lab",
      tags: ["classic", "simple", "beginner"],
      category: "basic",
      nodeCount: 1,
      wireCount: 0,
      nodes: [{ type: "execution", name: "Ralph Executor", x: 300, y: 180 }],
      wires: [],
    },
    {
      id: "exec-eval",
      name: "Execute & Evaluate",
      description:
        "Two-loop pattern: Execution does work, Evaluation verifies.",
      version: "1.0.0",
      author: "Agentic Lab",
      tags: ["intermediate", "verification"],
      category: "intermediate",
      nodeCount: 2,
      wireCount: 2,
      nodes: [
        { type: "execution", name: "Executor", x: 120, y: 160 },
        { type: "evaluation", name: "Evaluator", x: 500, y: 160 },
      ],
      wires: [
        {
          fromNode: 0,
          fromPort: "result",
          toNode: 1,
          toPort: "execution_result",
        },
        { fromNode: 1, fromPort: "corrections", toNode: 0, toPort: "task" },
      ],
    },
    {
      id: "plan-exec-eval",
      name: "Plan → Execute → Evaluate",
      description:
        "Three-loop: strategic planning, execution, then verification.",
      version: "1.0.0",
      author: "Agentic Lab",
      tags: ["intermediate", "planning", "verification"],
      category: "intermediate",
      nodeCount: 3,
      wireCount: 4,
      nodes: [
        { type: "planning", name: "Strategic Planner", x: 80, y: 180 },
        { type: "execution", name: "Task Executor", x: 400, y: 100 },
        { type: "evaluation", name: "Output Evaluator", x: 400, y: 340 },
      ],
      wires: [
        { fromNode: 0, fromPort: "task", toNode: 1, toPort: "task" },
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 2,
          toPort: "execution_result",
        },
        { fromNode: 2, fromPort: "corrections", toNode: 1, toPort: "task" },
        {
          fromNode: 2,
          fromPort: "evaluation",
          toNode: 0,
          toPort: "evaluation",
        },
      ],
    },
    {
      id: "full-agent-pipeline",
      name: "Full Agent Pipeline",
      description:
        "All 5 specialized loops: Planning → Execution → Evaluation → Critic → Memory.",
      version: "1.0.0",
      author: "Agentic Lab",
      tags: ["advanced", "full", "specialized"],
      category: "advanced",
      nodeCount: 5,
      wireCount: 12,
      nodes: [
        { type: "planning", name: "Strategic Planner", x: 80, y: 200 },
        { type: "execution", name: "Task Executor", x: 420, y: 60 },
        { type: "evaluation", name: "Output Evaluator", x: 420, y: 300 },
        { type: "critic", name: "Anti-Ralph Critic", x: 760, y: 60 },
        { type: "memory", name: "Context Compressor", x: 760, y: 300 },
      ],
      wires: [
        // planning → execution
        { fromNode: 0, fromPort: "task", toNode: 1, toPort: "task" },
        // execution → evaluation
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 2,
          toPort: "execution_result",
        },
        // evaluation → planning (feedback loop)
        {
          fromNode: 2,
          fromPort: "evaluation",
          toNode: 0,
          toPort: "evaluation",
        },
        // evaluation → planning (corrections feed back)
        { fromNode: 2, fromPort: "corrections", toNode: 1, toPort: "task" },
        // execution → critic
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 3,
          toPort: "execution_result",
        },
        { fromNode: 1, fromPort: "tokens", toNode: 3, toPort: "token_usage" },
        // evaluation → critic
        { fromNode: 2, fromPort: "metrics", toNode: 3, toPort: "eval_metrics" },
        // critic → planning
        {
          fromNode: 3,
          fromPort: "critic_feedback",
          toNode: 0,
          toPort: "critic_feedback",
        },
        // execution → memory
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 4,
          toPort: "execution_result",
        },
        // evaluation → memory
        {
          fromNode: 2,
          fromPort: "evaluation",
          toNode: 4,
          toPort: "evaluation",
        },
        // memory → execution (context)
        {
          fromNode: 4,
          fromPort: "compressed_context",
          toNode: 1,
          toPort: "context",
        },
        // memory → planning
        { fromNode: 4, fromPort: "memory", toNode: 0, toPort: "memory" },
      ],
    },
    {
      id: "deep-reasoning",
      name: "Deep Reasoning Agent",
      description:
        "Iterative self-correcting agent inspired by o1/Opus reasoning. Plans → Executes → Evaluates → decides to Refine or Backtrack → re-plans until convergence (max 3 rounds).",
      version: "1.0.0",
      author: "Agentic Lab",
      tags: ["advanced", "reasoning", "iterative", "self-correcting"],
      category: "advanced",
      nodeCount: 5,
      wireCount: 14,
      nodes: [
        { type: "planning", name: "Strategic Planner", x: 80, y: 200 },
        { type: "execution", name: "Task Executor", x: 380, y: 80 },
        { type: "evaluation", name: "Strict Evaluator", x: 380, y: 320 },
        { type: "critic", name: "Systemic Critic", x: 680, y: 200 },
        { type: "refinement", name: "Refinement Gate", x: 680, y: 400 },
      ],
      wires: [
        // planning → execution
        { fromNode: 0, fromPort: "task", toNode: 1, toPort: "task" },
        // execution → evaluation
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 2,
          toPort: "execution_result",
        },
        // execution → critic
        {
          fromNode: 1,
          fromPort: "result",
          toNode: 3,
          toPort: "execution_result",
        },
        // evaluation → critic
        { fromNode: 2, fromPort: "metrics", toNode: 3, toPort: "eval_metrics" },
        // evaluation → refinement gate
        {
          fromNode: 2,
          fromPort: "evaluation",
          toNode: 4,
          toPort: "evaluation",
        },
        // critic → refinement gate
        {
          fromNode: 3,
          fromPort: "critic_feedback",
          toNode: 4,
          toPort: "critic_feedback",
        },
        // FEEDBACK LOOPS: refinement → planning (re-plan)
        {
          fromNode: 4,
          fromPort: "replan_signal",
          toNode: 0,
          toPort: "evaluation",
        },
        // refinement → execution (corrections)
        { fromNode: 4, fromPort: "corrections", toNode: 1, toPort: "task" },
        // evaluation → planning (direct feedback)
        {
          fromNode: 2,
          fromPort: "evaluation",
          toNode: 0,
          toPort: "evaluation",
        },
        // BACKTRACK wire: refinement → planning (full reset)
        {
          fromNode: 4,
          fromPort: "backtrack_signal",
          toNode: 0,
          toPort: "critic_feedback",
        },
        // planning self-loop (iteration marker)
        { fromNode: 0, fromPort: "task", toNode: 0, toPort: "memory" },
        // execution → evaluation (tokens for budget check)
        { fromNode: 1, fromPort: "tokens", toNode: 2, toPort: "ground_truth" },
        // critic → planning (watchdog feedback)
        {
          fromNode: 3,
          fromPort: "critic_feedback",
          toNode: 0,
          toPort: "critic_feedback",
        },
        // convergence: refinement → output
        { fromNode: 4, fromPort: "final_result", toNode: 1, toPort: "context" },
      ],
    },
  ];

  return NextResponse.json({ recipes });
}
