// ============================================
// The environment a tool's child process gets
// ============================================
// Children inherit an allow-list, never the server's whole environment, so a
// command a model writes cannot read API keys, database URLs or tokens.

/** Variables a shell needs to run ordinary commands; everything else is dropped. */
const INHERITED = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  // Windows needs these to start a process at all.
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
] as const;

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}
