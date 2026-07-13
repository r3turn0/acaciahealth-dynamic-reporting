import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // API-route tests import server modules; keep them isolated per file.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
