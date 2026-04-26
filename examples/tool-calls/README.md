# Tool calls

A Svelte version of Cloudflare's dynamic client-defined tools example.

This example uses `createAgent(...)` and `createAgentChat(...)` with a generic Cloudflare `AIChatAgent` Worker. The browser registers tool schemas at runtime, the Worker sends those schemas to the model, and the Svelte app handles tool calls with `chat.pendingToolCalls` and `toolCall.run(...)`.

This example shows how to:

- send client tool schemas with each chat request
- render pending and completed tool calls
- execute browser-side tools from Svelte
- use `toolCall.running`, `toolCall.handled`, and `toolCall.lastError`
- send tool output back to the Worker
- disable server-side continuation with `autoContinueAfterToolResult: false`

## Run

The Worker uses a remote Workers AI binding:

```jsonc
"ai": { "binding": "AI", "remote": true }
```

Local AI calls use your Wrangler Cloudflare session.

```bash
npx wrangler login
npm install
npm run dev
```

Open the local URL printed by Vite.

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The official Cloudflare dynamic-tools example currently uses Kimi. This example uses Gemma while developing to keep local runs inexpensive.
