import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/agents": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});
