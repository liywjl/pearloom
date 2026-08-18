import { defineConfig } from "vitest/config";

// Electron e2e suite (`npm run e2e`): launches the built app via Playwright.
// One app instance per file — no parallelism.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
