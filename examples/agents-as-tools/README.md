# Agents as tools

Svelte app showing a parent Cloudflare Agent dispatching helper Agents as tools.

A parent `Assistant` chat Agent exposes tools that dispatch helper Agents:

- `research` creates a `Researcher` Agent run.
- `plan` creates a `Planner` Agent run.
- `compare` creates two `Researcher` Agent runs in parallel.

The server sends `agent-tool-event` frames on the parent Agent socket. The Svelte UI collects them with `createAgentToolEvents({ agent })` and renders helper runs next to the matching chat tool call.

## What it demonstrates

- `createAgent(...)` for the parent Agent connection
- `createAgentChat(...)` for the parent chat stream
- `createAgentToolEvents(...)` for child Agent run state
- Durable Object sub-agents used as real helper Agents
- Grouping helper runs by the parent tool call id

## Cloudflare setup

The Worker uses a remote Workers AI binding:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

Local AI calls use your Wrangler Cloudflare session. If you are already logged in, you can skip the login command below.

## Run locally

Clone this repository, then run from this example directory:

```bash
pnpm install
pnpm exec wrangler login
pnpm run dev
```

Open the local URL printed by Vite.

## Try it

```txt
Compare Durable Objects and KV for chat history
Research Svelte runes
Plan a refactor for duplicated auth checks
```

## Build

```bash
pnpm run build
```

## Deploy

```bash
pnpm run build
pnpm exec wrangler deploy
```

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```
