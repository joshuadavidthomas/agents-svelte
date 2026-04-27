import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const TEST_WORKER_PORT = 18788;

const testsDir = import.meta.dirname;
const agentsTestsDir = path.resolve(testsDir, "../../../agents/src/tests");
const hasIntegrationWorker = fs.existsSync(path.join(agentsTestsDir, "worker.ts"));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __TEST_WORKER_URL__: JSON.stringify(`http://localhost:${TEST_WORKER_PORT}`),
  },
  test: {
    name: "svelte",
    browser: {
      enabled: true,
      instances: [
        {
          browser: "chromium",
          headless: true,
        },
      ],
      provider: playwright(),
    },
    clearMocks: true,
    globalSetup: hasIntegrationWorker ? [path.join(testsDir, "setup.ts")] : [],
    include: ["src/tests/**/*.test.ts"],
    fileParallelism: false,
    exclude: hasIntegrationWorker
      ? ["src/tests/ssr-factories.test.ts"]
      : ["src/tests/createAgent.svelte.test.ts", "src/tests/ssr-factories.test.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
