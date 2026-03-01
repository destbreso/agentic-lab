import type { BenchmarkSuite } from "./types";

/* ═══════════════════════════════════════════════════
   Benchmark Store — DB-persistent with in-memory cache
   ═══════════════════════════════════════════════════
   Suites are persisted to the database via the MemoryStore
   (namespace ["benchmarks"]) so they survive restarts.
   A process-wide in-memory cache (globalThis) keeps hot
   reads fast and allows in-flight mutation during execution.
   ═══════════════════════════════════════════════════ */

const NAMESPACE = ["benchmarks"];

const G = globalThis as unknown as {
  __benchSuites?: Map<string, BenchmarkSuite>;
  __benchHydrated?: boolean;
};

if (!G.__benchSuites) {
  G.__benchSuites = new Map();
}

const cache = G.__benchSuites;

// ── DB helpers (best-effort — never break if storage unavailable) ──

async function getStorage() {
  try {
    const { createStorage } = await import("@agentic-lab/core");
    return await createStorage();
  } catch {
    return null;
  }
}

/** Hydrate cache from DB on first access */
async function hydrateOnce(): Promise<void> {
  if (G.__benchHydrated) return;
  G.__benchHydrated = true;

  let storage: Awaited<ReturnType<typeof getStorage>> = null;
  try {
    storage = await getStorage();
    if (!storage) return;
    const items = await storage.memory.search(NAMESPACE, { limit: 500 });
    for (const item of items) {
      try {
        const suite = item.value as unknown as BenchmarkSuite;
        if (suite && suite.id && !cache.has(suite.id)) {
          cache.set(suite.id, suite);
        }
      } catch {
        // skip malformed entries
      }
    }
  } catch {
    // DB unavailable — cache stays as-is
  } finally {
    if (storage) storage.close().catch(() => {});
  }
}

/** Persist a single suite to DB (fire-and-forget) */
function persistToDB(suite: BenchmarkSuite): void {
  (async () => {
    let storage: Awaited<ReturnType<typeof getStorage>> = null;
    try {
      storage = await getStorage();
      if (!storage) return;
      await storage.memory.put(
        NAMESPACE,
        suite.id,
        suite as unknown as Record<string, unknown>,
      );
    } catch {
      // Best-effort — cache is the source of truth during execution
    } finally {
      if (storage) storage.close().catch(() => {});
    }
  })();
}

/** Remove a suite from DB (fire-and-forget) */
function removeFromDB(id: string): void {
  (async () => {
    let storage: Awaited<ReturnType<typeof getStorage>> = null;
    try {
      storage = await getStorage();
      if (!storage) return;
      await storage.memory.delete(NAMESPACE, id);
    } catch {
      // Best-effort
    } finally {
      if (storage) storage.close().catch(() => {});
    }
  })();
}

// ── Public API (unchanged signatures) ──

export async function getAllSuites(): Promise<BenchmarkSuite[]> {
  await hydrateOnce();
  return Array.from(cache.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getSuite(
  id: string,
): Promise<BenchmarkSuite | undefined> {
  await hydrateOnce();
  return cache.get(id);
}

export function saveSuite(suite: BenchmarkSuite): void {
  cache.set(suite.id, suite);
  // Persist completed / error suites immediately; running suites are
  // persisted periodically by the runner's onUpdate callback.
  if (suite.status === "completed" || suite.status === ("error" as string)) {
    persistToDB(suite);
  }
}

/** Persist current state to DB — called by the runner after each step */
export function flushSuite(suite: BenchmarkSuite): void {
  cache.set(suite.id, suite);
  persistToDB(suite);
}

export function deleteSuite(id: string): boolean {
  const deleted = cache.delete(id);
  if (deleted) removeFromDB(id);
  return deleted;
}
