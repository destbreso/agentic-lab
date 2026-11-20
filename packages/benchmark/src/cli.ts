#!/usr/bin/env node
// The engine logs only warnings: the progress lines are the output. Set before jig-core loads, since its loggers read it when made.
process.env.JIG_LOG_LEVEL ??= "warn";
await import("./main.js");
