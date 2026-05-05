# Basic chat

Minimal Svelte chat app using `createAgent(...)`, `createAgentChat(...)`, and a Cloudflare `AIChatAgent` Worker.

## What it demonstrates

- Connecting a Svelte component to an Agent Worker
- Sending messages with `chat.sendMessage(...)`
- Streaming assistant responses
- Rendering `chat.messages`
- Using `chat.isStreaming` for button and input state
- Stopping an active response with `chat.stop()`
- Clearing local and server history with `chat.clearHistory()`
- Showing a simple token/cost estimate for the current chat

## Cloudflare setup

The Worker uses a remote Workers AI binding:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

Local AI calls use your Wrangler Cloudflare session. Log in before running the dev server:

```bash
pnpm exec wrangler login
```

To check the active account:

```bash
pnpm exec wrangler whoami
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

The model id is shown in the app header.
