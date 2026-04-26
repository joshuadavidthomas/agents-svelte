# Human in the Loop

Svelte version of Cloudflare Agents' human-in-the-loop guide.

This example demonstrates three tool patterns with `AIChatAgent`:

- `needsApproval`: server-side tools that pause for user approval
- client-side tool execution: tools without `execute` are fulfilled in the browser
- automatic server tools: tools with `execute` and no approval run immediately

## Run

```bash
npm install
npm run dev
```

The example uses a remote Workers AI binding in local development. Make sure Wrangler is authenticated and your account has Workers AI access.

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
