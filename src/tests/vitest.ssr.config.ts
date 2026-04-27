import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  test: {
    name: "ssr",
    environment: "node",
    include: ["src/tests/ssr-factories.test.ts"],
  },
});
