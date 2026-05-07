# SvelteKit chat

SvelteKit app that keeps SSR enabled while using `createAgent(...)` and `createAgentChat(...)` in a browser component.

## What it demonstrates

- Creating Agent controllers during SvelteKit component setup
- Letting factories connect only after browser mount
- Passing server-loaded data into the chat component
- Running the SvelteKit app and Agent Worker as separate Workers
- Connecting the app to the Agent Worker by proxy or by `PUBLIC_AGENT_HOST`

## Why this example uses two Workers

SvelteKit's Cloudflare adapter generates the Worker entrypoint at `.svelte-kit/cloudflare/_worker.js`. Cloudflare Agent classes must be exported from the Worker module that owns the Durable Object binding.

To keep the setup explicit, this example runs:

- a SvelteKit Worker for the app UI
- an Agent Worker in `src/agent-worker.ts` for `/agents/*`

The SvelteKit page reads `PUBLIC_AGENT_HOST` from runtime public env in `+page.server.ts` and passes it to `createAgent(...)`. If `PUBLIC_AGENT_HOST` is not set, the app uses the current request host. That works when `/agents/*` is routed or proxied to the Agent Worker on the same domain.

## Cloudflare setup

The Agent Worker uses a remote Workers AI binding:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

Local AI calls use your Wrangler Cloudflare session. If you are already logged in, you can skip the login command below.

## Run locally

Clone this repository, then run from this example directory:

```bash
pnpm install
pnpm exec wrangler login
```

The Vite dev server proxies `/agents/*` to the Agent Worker on `127.0.0.1:8787`, so the default local setup does not need `PUBLIC_AGENT_HOST`.

Start both the SvelteKit app and Agent Worker with one command:

```bash
pnpm run dev
```

Open the local URL printed by Vite. The command starts both the SvelteKit app and the Agent Worker.

For debugging, you can still run the processes separately:

```bash
pnpm run dev:worker
pnpm run dev:app
```

To bypass the Vite proxy and connect directly to the Agent Worker, run the SvelteKit app with:

```bash
PUBLIC_AGENT_HOST=127.0.0.1:8787 pnpm run dev
```

## Build

```bash
pnpm run build
```

Preview the Agent Worker deploy without publishing:

```bash
pnpm exec wrangler deploy --dry-run --config wrangler.agent.jsonc
```

## Deploy

Deploy the Agent Worker first:

```bash
pnpm exec wrangler deploy --config wrangler.agent.jsonc
```

Then deploy the SvelteKit Worker.

Your deployed SvelteKit Worker must be able to reach the Agent Worker. Either route `/agents/*` to the Agent Worker on the same host, or configure `PUBLIC_AGENT_HOST`.

If `/agents/*` is routed to the Agent Worker on the same host as the SvelteKit app, you do not need `PUBLIC_AGENT_HOST`:

```bash
pnpm run build
pnpm exec wrangler deploy
```

If the SvelteKit Worker should connect directly to the Agent Worker host, configure `PUBLIC_AGENT_HOST` as a runtime Worker variable for the SvelteKit Worker before deploying. For example, add a `vars` block to `wrangler.jsonc`:

```jsonc
"vars": {
  "PUBLIC_AGENT_HOST": "agents-svelte-sveltekit-chat-agent.<subdomain>.workers.dev"
}
```

Then deploy:

```bash
pnpm run build
pnpm exec wrangler deploy
```

`PUBLIC_AGENT_HOST` can be a host name with an optional port. Protocol prefixes such as `https://` are accepted but not required.

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The model id is shown in the page header.
