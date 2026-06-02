import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests share a single real Postgres database and clean up after
    // themselves; run files serially to keep DB state deterministic.
    fileParallelism: false,
    env: {
      // Pin a deterministic encryption key so crypto round-trips are stable and
      // no master.key file is written to the home directory during tests.
      MCP_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
});
