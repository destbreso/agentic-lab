// ============================================
// jig-benchmark as a library
// ============================================
// The command (jig-benchmark run, report, estimate) is built from these; a
// script can use them to run an experiment or read one.

export { loadTaskSet, parseTaskSet, subset, type BenchTask, type TaskSet, type TaskSource, type DirectConvention } from "./taskset.js";
export { DATASETS, gsm8kAnswer, type Dataset, type DatasetId } from "./adapters/datasets.js";
export { buildTaskSet, cacheDir, fetchDataset, recordsOf, sampleIndices, taskSetText, type Fetched } from "./adapters/fetch.js";
export { loadSpec, loadSpecText, specHash, canonical, directApplies, DIRECT, DEFAULT_BASELINE, type LoadedSpec, type SpecData, type Arm, type ArmInfo, type ArmKind } from "./spec.js";
export { FileProblems } from "./document.js";
export { lockExperiment, readLock, LockRefused, LOCK_FILE, type Lock } from "./lock.js";
export { readResults, attemptKey, settled, counts, RESULTS_FILE, type AttemptRecord } from "./results.js";
export { runAttempt, runDirect, runTopologyAttempt, directPrompt, directWrite, lastLine, lastCodeBlock, type AttemptInput, type AttemptOutput, type AttemptRunner } from "./attempt.js";
export { planAttempts, runExperiment, type PlannedAttempt, type RunOptions, type RunSummary } from "./runner.js";
export { decide, sentence, summarise, type Decision, type Verdict, type Why, type ArmSummary, type Comparison, type Summary } from "./compare.js";
export { wilson, newcombe, runsPerArm, median, Z_95, Z_POWER_80, type Interval, type Proportion } from "./stats.js";
export { renderReport, renderTable, renderConclusions, buildSummary, shownPath, type ReportInput } from "./report.js";
export { estimate, renderEstimate, type Estimate } from "./estimate.js";
export { providerFor, type ModelProvider } from "./provider.js";
export { benchmarkVersion } from "./version.js";
