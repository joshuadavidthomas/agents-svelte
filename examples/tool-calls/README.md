# Tool calls

Svelte chat app that sends browser-defined tool schemas to a Cloudflare `AIChatAgent` Worker and resolves the resulting tool calls in the browser.

## What it demonstrates

- Sending client tool schemas with each chat request
- Rendering pending, running, completed, and failed tool calls
- Executing browser-side tools from Svelte
- Reading `toolCall.running`, `toolCall.handled`, and `toolCall.lastError`
- Sending tool output back to the Worker with `toolCall.run(...)` or `toolCall.addOutput(...)`
- Disabling server-side continuation with `autoContinueAfterToolResult: false`

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

Ask for information the browser can provide:

```txt
What page am I on?
What time is it?
What is my screen size?
```

Disable a tool in the sidebar and ask for it again. The server sees only the active client tool schemas.

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

The model id is shown in the app UI.
