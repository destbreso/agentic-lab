import { NextResponse } from 'next/server';

/**
 * GET /api/pipelines/recipes
 * List all available recipes.
 */
export async function GET() {
  // In production this would import from @agentic-lab/core
  // For now, return the built-in recipes as static data
  const recipes = [
    {
      id: 'ralph-loop',
      name: 'Ralph Loop',
      description:
        'Classic single-loop agent. Read specs → pick task → work → commit.',
      version: '1.0.0',
      author: 'Agentic Lab',
      tags: ['classic', 'simple', 'beginner'],
      category: 'basic',
      nodeCount: 1,
      wireCount: 0,
      nodes: [{ type: 'execution', name: 'Ralph Executor' }],
    },
    {
      id: 'exec-eval',
      name: 'Execute & Evaluate',
      description:
        'Two-loop pattern: Execution does work, Evaluation verifies.',
      version: '1.0.0',
      author: 'Agentic Lab',
      tags: ['intermediate', 'verification'],
      category: 'intermediate',
      nodeCount: 2,
      wireCount: 2,
      nodes: [
        { type: 'execution', name: 'Executor' },
        { type: 'evaluation', name: 'Evaluator' },
      ],
    },
    {
      id: 'full-agent-pipeline',
      name: 'Full Agent Pipeline',
      description:
        'All 5 specialized loops: Planning → Execution → Evaluation → Critic → Memory.',
      version: '1.0.0',
      author: 'Agentic Lab',
      tags: ['advanced', 'full', 'specialized'],
      category: 'advanced',
      nodeCount: 5,
      wireCount: 15,
      nodes: [
        { type: 'planning', name: 'Strategic Planner' },
        { type: 'execution', name: 'Task Executor' },
        { type: 'evaluation', name: 'Output Evaluator' },
        { type: 'critic', name: 'Anti-Ralph Critic' },
        { type: 'memory', name: 'Context Compressor' },
      ],
    },
  ];

  return NextResponse.json({ recipes });
}
