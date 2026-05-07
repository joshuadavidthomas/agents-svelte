import { defineConfig, devices } from "@playwright/test";

const fakeMediaArgs = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "basic-chat",
      testMatch: /basic-chat\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5173",
      },
    },
    {
      name: "tool-calls",
      testMatch: /tool-calls\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5174",
      },
    },
    {
      name: "human-in-the-loop",
      testMatch: /human-in-the-loop\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5175",
      },
    },
    {
      name: "multi-ai-chat",
      testMatch: /multi-ai-chat\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5178",
      },
    },
    {
      name: "voice-input",
      testMatch: /voice-input\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5176",
        permissions: ["microphone"],
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: "voice-agent",
      testMatch: /voice-agent\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5177",
        permissions: ["microphone"],
        launchOptions: { args: fakeMediaArgs },
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --dir ../../examples/basic-chat dev --host 127.0.0.1 --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --dir ../../examples/tool-calls dev --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --dir ../../examples/human-in-the-loop dev --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --dir ../../examples/multi-ai-chat dev --host 127.0.0.1 --port 5178 --strictPort",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --dir ../../examples/voice-input dev --host 127.0.0.1 --port 5176 --strictPort",
      url: "http://127.0.0.1:5176",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --dir ../../examples/voice-agent dev --host 127.0.0.1 --port 5177 --strictPort",
      url: "http://127.0.0.1:5177",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
