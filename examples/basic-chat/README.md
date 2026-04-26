# Basic chat

A minimal Svelte chat app using `createAgent(...)` and `createAgentChat(...)` with a Cloudflare `AIChatAgent` Worker.

This example shows how to:

- connect to an agent
- send messages
- stream assistant responses
- render `chat.messages`
- use `chat.isStreaming` for UI state
- stop an active response with `chat.stop()`
- start over with `chat.clearHistory()`

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

To check the active Wrangler account:

```bash
npx wrangler whoami
```

## Model

This example uses Workers AI with:

```txt
@cf/google/gemma-4-26b-a4b-it
```

The model id is shown in the app header so you can see what the Worker is using.

## Usage estimate

The header shows input tokens, output tokens, and estimated cost for the current chat. The estimate updates after each assistant turn and resets when you start a new chat.

If provider-reported usage metadata is available, the example uses it. Otherwise it falls back to a simple text-based estimate.
