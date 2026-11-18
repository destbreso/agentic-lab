// ============================================
// CLI: show a topology at rest
// ============================================
// `agentic-lab show <topology>` draws a built-in topology or a definition file
// on the core's grid, in the layout the terminal's width allows. --sight adds
// the walls, measured with a mock model: no network, no tokens. --play
// animates a dry run of it on the same scripted kind of model (play.ts).

import chalk from "chalk";
import { draw, drawingOf, initialRunState, layoutFor, measureSight, toANSI, toText, type LayoutName } from "@agentic-lab/core";
import { formatIssues, resolveTopology } from "../topology-arg.js";
import { playTopology } from "./play.js";

export interface ShowOptions {
  layout?: string;
  width?: string;
  sight?: boolean;
  plain?: boolean;
  model?: string;
  /** Animate a dry run on the scripted model, until a key or Ctrl+C. */
  play?: boolean;
  speed?: string;
  once?: boolean;
  frames?: string;
  record?: string;
}

const LAYOUTS = ["auto", "horizontal", "vertical", "strip"];

export async function showCommand(topologyArg: string, options: ShowOptions): Promise<void> {
  // The engine's own log stays out of a drawing.
  process.env.AGENTIC_LAB_LOG_LEVEL ??= "warn";
  try {
    if (options.layout && !LAYOUTS.includes(options.layout)) throw new Error(`--layout must be one of: ${LAYOUTS.join(", ")}`);
    const resolved = await resolveTopology(topologyArg);
    if (resolved.warnings.length) process.stderr.write(chalk.yellow(`${formatIssues(resolved.warnings)}\n`));
    if (options.play) {
      await playTopology(resolved, options);
      return;
    }
    const sight = options.sight ? await measureSight(resolved.topology) : undefined;
    const drawing = drawingOf(resolved.topology, { sight, source: resolved.source, model: options.model, builtIn: resolved.builtIn });
    const width = options.width ? parseInt(options.width, 10) : process.stdout.isTTY ? process.stdout.columns : 120;
    const layout: LayoutName = !options.layout || options.layout === "auto" ? layoutFor(drawing, width, { sight: Boolean(sight) }) : (options.layout as LayoutName);
    const grid = draw(drawing, initialRunState(0), layout, { sight: true, width });
    const color = !options.plain && process.stdout.isTTY && !process.env.NO_COLOR;
    process.stdout.write(`${color ? toANSI(grid) : toText(grid)}\n`);
  } catch (e) {
    process.stderr.write(chalk.red(`  ✗ ${(e as Error).message}\n`));
    process.exitCode = 2;
  }
}
