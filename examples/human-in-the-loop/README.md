# Human in the loop

Svelte chat app demonstrating Cloudflare Agents tool approvals and browser-resolved tools.

## What it demonstrates

- Server-side tools that pause for user approval with `needsApproval`
- Approval UI rendered from AI SDK tool parts
- Resolving approvals with `chat.addToolApprovalResponse(...)`
- Browser-side tool execution for tools without server `execute` functions
- Automatic server tools that run immediately
- Tool output and error rendering in Svelte

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

Ask:

```txt
What's the weather in Austin?
```

The assistant should request approval before running the weather tool.

Ask:

```txt
What time is it in Tokyo?
```

The browser handles the local-time tool call.

Ask:

```txt
What's the local news in Portland?
```

The server runs the local-news tool automatically.

Weather and news responses are deterministic demo responses, not live external data.

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
@cf/moonshotai/kimi-k2.6
```
