# SvelteKit chat

A SvelteKit app that uses `createAgent(...)` and `createAgentChat(...)` from a server-rendered route.

This example shows how to:

- keep SvelteKit SSR enabled
- create Agent controllers during component setup
- let factories connect only after browser mount
- pass server-loaded data into the chat component
- connect a SvelteKit frontend to a Cloudflare Agent Worker

## Why this example uses two Workers

SvelteKit's Cloudflare adapter generates the Worker entrypoint at `.svelte-kit/cloudflare/_worker.js`. Cloudflare Agent classes must be exported from the Worker module that owns the Durable Object binding.

To keep the setup explicit and portable, this example runs:

- a SvelteKit Worker for the app UI
- a small Agent Worker in `src/agent-worker.ts` for `/agents/*`

The SvelteKit app reads `PUBLIC_AGENT_HOST` and passes it to `createAgent(...)`. If `PUBLIC_AGENT_HOST` is not set, the app uses the current request host, which is useful when you route `/agents/*` to the Agent Worker behind the same domain.

## Run locally

Install dependencies:

```bash
npm install
```

The SvelteKit dev server proxies `/agents/*` to the Agent Worker via Vite's server proxy. Start both the Agent Worker and the SvelteKit app:

In terminal 1, start the Agent Worker:

```bash
npm run worker
```

In terminal 2, start the SvelteKit app:

```bash
npm run dev
```

Open the local URL printed by Vite (it will proxy Agent traffic to the Agent Worker on port 8787).

If you prefer to connect directly without the proxy, set `PUBLIC_AGENT_HOST`:

```bash
PUBLIC_AGENT_HOST=localhost:8787 npm run dev
```

The Agent Worker uses a remote Workers AI binding:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

Local AI calls use your Wrangler Cloudflare session. If needed, run:

```bash
npx wrangler login
```

## Build

```bash
npm run check
npm run build
```

## Deploy

Deploy the Agent Worker first:

```bash
npx wrangler deploy --config wrangler.agent.jsonc
```

Then deploy the SvelteKit Worker with `PUBLIC_AGENT_HOST` set to the Agent Worker host:

```bash
PUBLIC_AGENT_HOST=cloudflare-agents-svelte-sveltekit-chat-agent.<subdomain>.workers.dev npm run build
npx wrangler deploy
```

If you proxy `/agents/*` to the Agent Worker on the same domain, omit `PUBLIC_AGENT_HOST` and the client will use the current host.

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The model id is shown in the page header so you can see what the Worker is using.
