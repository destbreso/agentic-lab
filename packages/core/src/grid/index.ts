// The viewer's layout engine: a topology and a run state in, a grid of cells
// with meanings out, drawn by the web and the terminal alike.
export { Grid, toText, toANSI, stripANSI, meaningsOf, fit, len, SGR, type Cell, type Meaning } from "./grid.js";
export { drawingOf, roundLimit, type Drawing, type DrawingOptions, type DrawnRole, type DrawnBack, type DrawnConsult, type DrawnSight } from "./drawing.js";
export { initialRunState, reduceRun, foldRun, shortTokens, elapsed, type RunState, type RoundMark } from "./run-state.js";
export { horizontal, vertical, strip, draw, layoutFor, horizontalWidth, SPINNER, type LayoutName, type LayoutOptions } from "./layout.js";
