// The viewer's layout engine: a topology and a run state in, a grid of cells
// with meanings out, drawn by the web and the terminal alike.
export { Grid, toText, toANSI, stripANSI, meaningsOf, fit, len, SGR, type Cell, type Meaning } from "./grid.js";
export { drawingOf, roundLimit, effectiveLimit, type Drawing, type DrawingOptions, type DrawnRole, type DrawnBack, type DrawnConsult, type DrawnSight } from "./drawing.js";
export { initialRunState, reduceRun, foldRun, shortTokens, elapsed, LOG_KEEP, type RunState, type RoundMark, type RoleTurn, type Consultation, type LogEntry } from "./run-state.js";
export { horizontal, vertical, strip, draw, layoutFor, horizontalWidth, bar, SPINNER, type LayoutName, type LayoutOptions } from "./layout.js";
export { rail, logPanel, logLines, logText, ticker, footer, RAIL_W, type FooterOptions, type LogView } from "./panels.js";
export { screen, screenWidth, drawingBlock, LOG_BESIDE_MIN, type Screen, type ScreenOptions } from "./screen.js";
