import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import net from "node:net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_WORKER_PORT = 18788;

declare global {
  // eslint-disable-next-line no-var
  var __svelteTestWorker__: Unstable_DevWorker | undefined;
  // eslint-disable-next-line no-var
  var __svelteTestSetupDone__: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __svelteTestSignalHandlers__: boolean | undefined;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "0.0.0.0");
  });
}

function killProcessOnPort(port: number): void {
  try {
    const output = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`).toString().trim();
    if (output) {
      const pids = output.split("\n").filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGKILL");
          console.log(`[setup] Killed stale process ${pid} on port ${port}`);
        } catch {
          // already exited
        }
      }
    }
  } catch {
    // lsof unavailable
  }
}

async function stopWorker() {
  const worker = globalThis.__svelteTestWorker__;
  if (worker) {
    console.log("[teardown] Stopping svelte test worker...");
    try {
      await worker.stop();
    } catch (error) {
      console.error("[teardown] Error stopping worker:", error);
      killProcessOnPort(TEST_WORKER_PORT);
    }
    globalThis.__svelteTestWorker__ = undefined;
  }
}

async function doSetup() {
  const portAvailable = await isPortAvailable(TEST_WORKER_PORT);
  if (!portAvailable) {
    console.log(`[setup] Port ${TEST_WORKER_PORT} in use — killing stale process...`);
    killProcessOnPort(TEST_WORKER_PORT);
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!globalThis.__svelteTestSignalHandlers__) {
    globalThis.__svelteTestSignalHandlers__ = true;
    const onSignal = () => {
      stopWorker().finally(() => process.exit(1));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }

  console.log("[setup] Starting svelte test worker...");
  const agentsTestsDir = path.resolve(__dirname, "../../../agents/src/tests");
  const workerPath = path.join(agentsTestsDir, "worker.ts");
  const configPath = path.join(agentsTestsDir, "wrangler.jsonc");

  try {
    globalThis.__svelteTestWorker__ = await unstable_dev(workerPath, {
      config: configPath,
      experimental: {
        disableExperimentalWarning: true,
      },
      port: TEST_WORKER_PORT,
      ip: "0.0.0.0",
      persist: false,
      logLevel: "warn",
    });

    console.log(`[setup] Svelte test worker started at http://127.0.0.1:${TEST_WORKER_PORT}`);
  } catch (error) {
    console.error("[setup] Failed to start svelte test worker:", error);
    throw error;
  }
}

export async function setup() {
  // globalSetup may be invoked more than once across vitest's main + browser
  // runners — deduplicate via globalThis so we never kill our own worker.
  if (!globalThis.__svelteTestSetupDone__) {
    globalThis.__svelteTestSetupDone__ = doSetup();
  }
  await globalThis.__svelteTestSetupDone__;
}

export async function teardown() {
  await stopWorker();
}
