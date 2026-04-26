# Multi AI Chat

A Svelte version of Cloudflare's multi-session AI chat example.

One `Inbox` Durable Object owns the chat list and shared per-user memory. Each chat is a `Chat` sub-agent with its own persisted `AIChatAgent` history, routed under the inbox:

```txt
/agents/inbox/demo-user
/agents/inbox/demo-user/sub/chat/{chatId}
```

The Svelte UI connects to the inbox with `createAgent(...)`, derives the active chat from reactive state, and uses `createAgentChat(...)` for the selected chat.

## What it demonstrates

- A top-level stateful `Agent` for shared sidebar state.
- `AIChatAgent` sub-agents for independent chat sessions.
- Reactive Svelte state for chat selection, shared memory, connection status, and usage display.
- Agent RPC with `agent.stub.createChat()`, `renameChat()`, `deleteChat()`, `getSharedMemory()`, and `setSharedMemory()`.
- Shared memory injected into every chat's system prompt.
- Server-side tools for remembering facts, recalling memory, and getting the current time.

## Run locally

Install dependencies:

```bash
npm install
```

Log in to Cloudflare if needed:

```bash
npx wrangler login
```

Start the Vite/Workers dev server:

```bash
npm run dev
```

Open the local URL printed by Vite.

## Workers AI

This example uses a remote Workers AI binding in `wrangler.jsonc`:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

The dogfooding model is currently:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The official Cloudflare example currently uses `@cf/moonshotai/kimi-k2.5`. This example uses Gemma while developing to keep local testing cheaper.

## Validate

```bash
npm run check
npm run build
```
