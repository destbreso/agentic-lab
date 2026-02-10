import { NextResponse } from 'next/server';

/**
 * GET /api/pipelines/node-types
 * List all registered node types.
 */
export async function GET() {
  const nodeTypes = [
    {
      type: 'execution',
      name: 'Execution Loop',
      category: 'execution',
      description:
        'Fast, stateless executor. Picks a task, calls LLM with tools, does work.',
      version: '1.0.0',
      defaultConfig: { maxIterations: 20, delayMs: 500, concurrent: false },
      ports: {
        inputs: [
          { name: 'task', signalTypes: ['task', 'plan'], required: true },
          { name: 'context', signalTypes: ['context', 'memory'], required: false },
        ],
        outputs: [
          { name: 'result', signalTypes: ['execution_result'] },
          { name: 'tool_calls', signalTypes: ['tool_calls'] },
          { name: 'tokens', signalTypes: ['token_usage'] },
        ],
      },
    },
    {
      type: 'evaluation',
      name: 'Evaluation Loop',
      category: 'evaluation',
      description:
        'Verifies real-world changes. Never trusts execution output alone.',
      version: '1.0.0',
      defaultConfig: { maxIterations: 1, delayMs: 0, concurrent: false },
      ports: {
        inputs: [
          { name: 'execution_result', signalTypes: ['execution_result'], required: true },
          { name: 'ground_truth', signalTypes: ['ground_truth', 'test_results'], required: false },
        ],
        outputs: [
          { name: 'evaluation', signalTypes: ['evaluation'] },
          { name: 'corrections', signalTypes: ['corrections'] },
          { name: 'metrics', signalTypes: ['eval_metrics'] },
        ],
      },
    },
    {
      type: 'planning',
      name: 'Planning Loop',
      category: 'planning',
      description:
        'Slow, strategic planner. Reviews aggregate state, adjusts direction.',
      version: '1.0.0',
      defaultConfig: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: false,
        frequency: { everyNIterations: 5 },
      },
      ports: {
        inputs: [
          { name: 'evaluation', signalTypes: ['evaluation', 'eval_metrics'], required: true },
          { name: 'execution_result', signalTypes: ['execution_result'], required: false },
          { name: 'critic_feedback', signalTypes: ['critic_feedback'], required: false },
          { name: 'memory', signalTypes: ['memory', 'compressed_context'], required: false },
        ],
        outputs: [
          { name: 'plan', signalTypes: ['plan'] },
          { name: 'strategy', signalTypes: ['strategy'] },
          { name: 'task', signalTypes: ['task'] },
        ],
      },
    },
    {
      type: 'critic',
      name: 'Critic Loop',
      category: 'critic',
      description:
        'Adversarial watchdog. Detects stagnation, circularity, cost runaway.',
      version: '1.0.0',
      defaultConfig: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true,
        frequency: { everyNIterations: 3 },
      },
      ports: {
        inputs: [
          { name: 'execution_result', signalTypes: ['execution_result', 'tool_calls'], required: true },
          { name: 'eval_metrics', signalTypes: ['eval_metrics', 'evaluation'], required: true },
          { name: 'token_usage', signalTypes: ['token_usage'], required: true },
        ],
        outputs: [
          { name: 'critic_feedback', signalTypes: ['critic_feedback'] },
          { name: 'stagnation_alert', signalTypes: ['stagnation_alert'] },
          { name: 'intervention', signalTypes: ['intervention'] },
        ],
      },
    },
    {
      type: 'memory',
      name: 'Memory Loop',
      category: 'memory',
      description:
        'Summarizes, compresses, denoises. Creates canonical state snapshots.',
      version: '1.0.0',
      defaultConfig: {
        maxIterations: 1,
        delayMs: 0,
        concurrent: true,
        frequency: { everyNIterations: 3 },
      },
      ports: {
        inputs: [
          { name: 'execution_result', signalTypes: ['execution_result', 'tool_calls'], required: true },
          { name: 'evaluation', signalTypes: ['evaluation', 'eval_metrics'], required: true },
          { name: 'strategy', signalTypes: ['strategy'], required: false },
        ],
        outputs: [
          { name: 'compressed_context', signalTypes: ['compressed_context'] },
          { name: 'milestone', signalTypes: ['milestone'] },
          { name: 'memory', signalTypes: ['memory'] },
        ],
      },
    },
  ];

  return NextResponse.json({ nodeTypes });
}
