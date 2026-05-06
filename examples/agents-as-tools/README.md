# Agents as tools

Svelte version of Cloudflare's Agents-as-tools example.

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

Local AI calls use your Wrangler Cloudflare session. Log in before running the dev server:

```bash
pnpm exec wrangler login
```

## Run locally

```bash
pnpm install
pnpm run dev
```

Open the local URL printed by Vite.

Try:

```txt
Compare Durable Objects and KV for chat history
Research Svelte runes
Plan a refactor for duplicated auth checks
```

## Validate

```bash
pnpm run check
pnpm run build
```

## Deploy

```bash
pnpm run build
pnpm exec wrangler deploy
```
