// ============================================
// Keys Jig has read, and their removal from anything it writes
// ============================================
// Every key resolved for a provider is registered here, and redact() takes
// each one out of a text before it reaches a log, an error, a run's files or
// a session. Keys are never written by Jig in the first place; this is the
// net under that rule.

const secrets = new Set<string>();

/** Remember a key so it is redacted wherever it might appear. Short values are not keys. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

/** The text with every registered key replaced by [redacted]. */
export function redact(text: string): string {
  if (!secrets.size || !text) return text;
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join("[redacted]");
  return out;
}

/** For tests: forget every key. */
export function clearSecrets(): void {
  secrets.clear();
}
