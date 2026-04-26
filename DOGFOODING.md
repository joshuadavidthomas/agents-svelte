# Dogfooding notes

## basic-chat

Status: working in browser.

Official example mirrored:

- Closest match: `cloudflare/agents/examples/ai-chat`
- Official model: `@cf/moonshotai/kimi-k2.6`
- Current dogfooding model: `@cf/google/gemma-4-26b-a4b-it`

Felt good:

- `createAgent(...)` + `createAgentChat(...)` as two objects feels fine in the example. The split makes sense because the agent connection is reusable and chat is a controller layered on top.
- Source-only package consumption works in a real Svelte/Vite/Cloudflare Workers app.
- Streaming responses work.
- `chat.isStreaming` is enough for send/stop button state.
- `chat.stop()` works and maps naturally to a Stop button.
- `chat.clearHistory()` works for a New-chat action.
- Rendering `chat.messages` directly is straightforward.
- Reasoning parts are present in `chat.messages` and can be rendered explicitly.
- The UI now feels closer to Cloudflare's examples: narrow centered layout, simple bubbles, fixed composer, minimal header.

Felt awkward:

- The first UI pass felt too much like a generic generated SaaS card. Examples should mirror Cloudflare's examples in copy and layout.
- User-facing copy should not mention dogfooding. Dogfooding belongs in this file, not in the example UI or model prompt.
- `clearHistory()` does not reset app-local UI state such as the estimated token/cost counter. The example needs to reset that state itself when starting a new chat.
- Provider usage metadata did not appear reliably enough in the client for the token/cost display.
- A fully reactive token/cost estimate updated while text streamed, which was distracting. Updating after each agent turn feels better.
- Gemma exposes verbose `reasoning` parts for simple prompts. The adapter is surfacing the parts correctly, but the basic chat example may not want prominent reasoning UI.

API changes to consider:

- None from the core `Agent` + `AgentChat` happy path so far.
- No package API change is needed for local UI state reset after `clearHistory()`.
- Usage/cost display should remain example-local unless the Agents/AI SDK path exposes reliable usage metadata in a standard way.

Docs needed:

- Explain that local Workers AI auth comes from Wrangler/Cloudflare login when `wrangler.jsonc` uses an AI binding with `remote: true`.
- Note that the example uses a cheaper Workers AI model during dogfooding and may switch to the official Cloudflare example model before publish.
- If token/cost display stays, document that it is an estimate unless provider usage metadata is available.
- Keep README/example copy aligned with official Cloudflare examples and avoid internal dogfooding language.
