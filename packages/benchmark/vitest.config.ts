import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    // The engine's own log is noise here: the tests read the records.
    env: { JIG_LOG_LEVEL: "warn" },
  },
});
