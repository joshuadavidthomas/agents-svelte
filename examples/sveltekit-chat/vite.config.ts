import { readFile } from "node:fs/promises";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import rehypePrism from "rehype-prism-plus/all";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { defineConfig, type Plugin } from "vite";

const ASIDE_RE = /<!--\s*aside:start\s*-->([\s\S]*?)<!--\s*aside:end\s*-->/g;
const QUERY = "?aside-html";

function readmeAsideHtmlPlugin(): Plugin {
  return {
    name: "readme-aside-html",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(QUERY)) return null;
      const resolved = await this.resolve(source.slice(0, -QUERY.length), importer, {
        skipSelf: true,
      });
      return resolved ? resolved.id + QUERY : null;
    },
    async load(id) {
      if (!id.endsWith(QUERY)) return null;
      const filePath = id.slice(0, -QUERY.length);
      this.addWatchFile(filePath);
      const md = await readFile(filePath, "utf8");
      const parts = [...md.matchAll(ASIDE_RE)]
        .map((m) => m[1].trim())
        .map((part) => part.replace(/^```jsonc$/gm, "```json"));
      const file = await unified()
        .use(remarkParse)
        .use(remarkRehype)
        .use(rehypePrism, { ignoreMissing: true })
        .use(rehypeStringify)
        .process(parts.join("\n\n"));
      return `export default ${JSON.stringify(String(file))};`;
    },
  };
}

export default defineConfig({
  plugins: [readmeAsideHtmlPlugin(), tailwindcss(), sveltekit()],
});
