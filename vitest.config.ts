import { defineConfig } from "vitest/config";

// Default run: unit + integration tests. The Electron e2e suite is slower and
// drives a real app window, so it lives behind `npm run e2e`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
