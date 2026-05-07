<!-- aside:start -->

# SvelteKit chat

SvelteKit app that serves SSR pages and Cloudflare Agent routes from one Worker.

This example shows how to create `createAgent(...)` and `createAgentChat(...)` controllers during component setup, keep SSR enabled, and mount the Agents protocol at `/agents/*` inside the SvelteKit app.

<!-- aside:end -->

## Quick start

Run from this example directory:

```bash
pnpm install
pnpm exec wrangler login
pnpm run dev
```

Open the local URL printed by Wrangler. The app and `/agents/*` routes are served by the same local Worker.

Build and preview the Worker deploy without publishing:

```bash
pnpm run build
pnpm exec wrangler deploy --dry-run
```

Deploy:

```bash
pnpm run build
pnpm exec wrangler deploy
```

<!-- aside:start -->

## How it works

### Agent route

The Agent implementation lives in `src/agent.ts`. The SvelteKit endpoint at `src/routes/agents/[...path]/+server.ts` forwards `/agents/*` requests to `routeAgentRequest(request, platform.env)`.

The endpoint dynamically imports `agents` so SvelteKit's Node build does not try to load Cloudflare-only `cloudflare:*` modules:

```ts
const { routeAgentRequest } = await import("agents");
```

### Worker entrypoint

Cloudflare Durable Object migrations require `ChatAgent` to be exported from the deployed Worker module. `worker.ts` handles that export, then delegates `fetch` to SvelteKit's generated Worker:

```ts
import { ChatAgent } from "./src/agent";
import sveltekitWorker from "./.svelte-kit/cloudflare/_worker.js";

export { ChatAgent };

export default sveltekitWorker;
```

`svelte.config.js` points the official adapter at `wrangler.sveltekit.jsonc` so the adapter writes its generated Worker without overwriting `worker.ts`. `wrangler.jsonc` is the deploy/dev config.

### Cloudflare bindings

The Worker uses Workers AI and a Durable Object binding for `ChatAgent`:

```jsonc
"ai": { "binding": "AI", "remote": true },
"durable_objects": {
  "bindings": [{ "name": "ChatAgent", "class_name": "ChatAgent" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
```

Local AI calls use your Wrangler Cloudflare session.

<!-- aside:end -->

## Variants

### Separate Workers

You can deploy the SvelteKit app and Agent backend as separate Workers. This is useful when one Agent backend serves multiple frontends or when you want the Agent Worker to follow the official Cloudflare Agents examples exactly.

For that shape, create a dedicated Agent Worker that exports `ChatAgent` and calls `routeAgentRequest(...)` from its `fetch` handler. The SvelteKit app can connect to that Worker by routing `/agents/*` to it, or by passing `host` to `createAgent(...)`.

### Community adapter

[`@joshthomas/sveltekit-adapter-cloudflare`](https://github.com/joshuadavidthomas/sveltekit-adapter-cloudflare) lets a SvelteKit app provide Cloudflare platform exports from `src/platform.cloudflare.ts`.

With that adapter, you can replace `worker.ts` and `wrangler.sveltekit.jsonc` with:

```ts
// src/platform.cloudflare.ts
export { ChatAgent } from "./agent";
```

That keeps SvelteKit's generated `fetch` handler and removes the build-only Wrangler config.

## Model

This example uses Workers AI with `@cf/google/gemma-4-26b-a4b-it`. The model id is shown in the page header.
