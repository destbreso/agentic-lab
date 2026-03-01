import type { BenchmarkSuite } from "./types";

/* ═══════════════════════════════════════════════════
   Benchmark Store — process-wide singleton via globalThis
   ═══════════════════════════════════════════════════
   Same pattern as the job-store: avoids Next.js module
   duplication across route files with Turbopack.
   ═══════════════════════════════════════════════════ */

const G = globalThis as unknown as {
  __benchSuites?: Map<string, BenchmarkSuite>;
};

if (!G.__benchSuites) {
  G.__benchSuites = new Map();
}

const suites = G.__benchSuites;

export function getAllSuites(): BenchmarkSuite[] {
  return Array.from(suites.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getSuite(id: string): BenchmarkSuite | undefined {
  return suites.get(id);
}

export function saveSuite(suite: BenchmarkSuite): void {
  suites.set(suite.id, suite);
}

export function deleteSuite(id: string): boolean {
  return suites.delete(id);
}
