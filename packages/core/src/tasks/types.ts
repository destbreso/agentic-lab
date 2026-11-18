// ============================================
// Tasks and their checks
// ============================================
// A task carries the checks that say whether it was done. The lab runs them,
// not a role: in a fresh copy of the workspace it makes for each check, with
// the task's check files copied back in from its own copy, so a role that
// edits them changes nothing (FOUNDATIONS, H4).

/** One measured check. Every condition given must hold. */
export type TaskCheck =
  | {
      name: string;
      /** Run a command in the copy; it passes when it exits 0. */
      kind: "command";
      command: string;
      /** Default 60 s. */
      timeoutMs?: number;
    }
  | {
      name: string;
      /** Read a file in the copy. A missing file fails. */
      kind: "file";
      path: string;
      /** The file's text, trimmed, equals this, trimmed. */
      equals?: string;
      contains?: string;
      /** A regular expression the trimmed text matches. */
      matches?: string;
    }
  | {
      name: string;
      /** Compare Do's final answer. */
      kind: "answer";
      equals?: string;
      contains?: string;
      matches?: string;
    };

/**
 * A file a check depends on. A path alone is read from the workspace when the
 * run starts, before any role has run; with content, the content is used.
 */
export type CheckFile = string | { path: string; content: string };

/** The result of one check, every value measured by the lab. */
export interface MeasuredCheckResult {
  name: string;
  kind: TaskCheck["kind"];
  passed: boolean;
  /** A command's exit code (null when it was killed). */
  exitCode?: number | null;
  /** What the command printed, or what the file or answer held against what was expected. */
  output: string;
  durationMs: number;
}

/** One run of a task's checks. */
export interface MeasuredCheckRun {
  /** "final" after the run, or the round and role it was run for. */
  label: string;
  /** True when every check passed. */
  passed: boolean;
  results: MeasuredCheckResult[];
  at: string;
  durationMs: number;
}

/** Runs a task's checks. The lab's own runner is MeasuredChecker; tests may script one. */
export interface CheckRunner {
  /** Keep the originals of the check files, before any role runs. */
  capture(): Promise<void>;
  /** Run every check once, against the workspace as it is now. */
  run(opts: { label: string; answer?: string; signal?: AbortSignal }): Promise<MeasuredCheckRun>;
}
