# Multi AI chat

Inbox-style Svelte chat app with one top-level Agent and multiple chat sub-agents.

One `Inbox` Durable Object owns the chat list and shared per-user memory. Each chat is a `Chat` sub-agent with its own persisted `AIChatAgent` history, routed under the inbox:

```txt
/agents/inbox/demo-user
/agents/inbox/demo-user/sub/chat/{chatId}
```

The Svelte UI connects to the inbox with `createAgent(...)`, derives the active chat from reactive state, and creates an `AgentChat` for the selected chat.

## What it demonstrates

- A top-level stateful `Agent` for shared sidebar state
- `AIChatAgent` sub-agents for independent chat sessions
- Reactive Svelte state for chat selection, shared memory, connection status, and usage display
- Agent RPC with `agent.stub.createChat()`, `renameChat()`, `deleteChat()`, `getSharedMemory()`, and `setSharedMemory()`
- Shared memory injected into every chat's system prompt
- Server-side tools for remembering facts, recalling memory, and getting the current time

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

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The model id is shown in the app UI.
