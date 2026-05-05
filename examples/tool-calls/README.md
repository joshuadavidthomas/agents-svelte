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
