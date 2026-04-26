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

## multi-ai-chat

Status: initial implementation complete; browser dogfooding still needed.

Official example mirrored:

- Closest match: `cloudflare/agents/examples/multi-ai-chat`
- Official model: `@cf/moonshotai/kimi-k2.5`
- Current dogfooding model: `@cf/google/gemma-4-26b-a4b-it`

Felt good:

- The parent `Inbox` agent plus child `Chat` sub-agent pattern maps cleanly to Svelte state: `inbox.state` drives the sidebar, and the active chat is derived from the selected chat id.
- Typed `inbox.stub` calls make sidebar operations straightforward: create, rename, delete, load memory, and save memory.
- The UI can keep Cloudflare's multi-session chat shape while using Svelte runes for selection, usage, memory draft state, and scrolling effects.

Felt awkward:

- The Svelte adapter did not expose the official React `sub: [...]` option, so this example required adding sub-agent routing support to `createAgent(...)`.
- Deriving an active chat connection from `activeId` needs browser testing. This is the intended explicit-lifetime path: factories are for component init with automatic `onDestroy`, while classes are for dynamic or non-component lifetimes with explicit `close()`.
- The initial implementation mirrors behavior and validates with typecheck/build, but it still needs browser testing for sub-agent WebSocket routing and shared memory tools.

API changes to consider:

- Keep `sub` in `CreateAgentOptions` if browser testing confirms it behaves correctly.
- Document two Svelte-native lifetime patterns clearly: factory calls at component init, or direct classes with explicit cleanup for dynamic identities.

## human-in-the-loop

Status: implemented; browser dogfooding found approval-continuation edge cases now covered by tests.

Official example mirrored:

- Closest match: `cloudflare/agents/guides/human-in-the-loop`
- Official model: `@cf/moonshotai/kimi-k2.6`
- Current dogfooding model: `@cf/moonshotai/kimi-k2.6`

Felt good:

- `needsApproval` tool parts map naturally to Svelte UI: derive pending approvals from `chat.messages`, render Approve/Reject actions, then call `chat.addToolApprovalResponse(...)`.
- Browser-side tools work through `chat.pendingToolCalls` and `toolCall.run(...)` without adding another public API.
- The official example's three tool categories are expressible with the same Svelte chat controller: approval-required weather, browser-handled time, automatic server news.

Felt awkward / bugs found:

- A custom system prompt leaked implementation details into the model context and caused the model to explain browser time instead of calling the local-time tool. Removed it to match upstream, which relies on tool descriptions.
- `chat.isStreaming` alone misses the submitted-before-first-chunk state. Examples now show `Thinking` from `chat.status === "submitted"`.
- Approval continuation streams can resume with missing `reasoning-start` or `text-start` chunks. The direct transport now synthesizes missing starts.
- After approval, server sync messages could overwrite locally repaired continuation parts, making final reasoning/text briefly appear and then disappear. The chat controller now protects the current assistant tail during tool continuation and releases it when the continuation finishes.

Tests added:

- Protocol regression in `src/tests/createAgentChat.svelte.test.ts` for approval → continuation → stale `message-updated`/`messages-replaced` sync → final reasoning/text preservation.
- Rendering regression in `src/tests/humanInTheLoopRendering.svelte.test.ts` using a small Svelte transcript harness to verify initial reasoning, final reasoning, tool output, and final text remain visible.

API changes to consider:

- No new public API yet. The fixes are transport/controller robustness around existing approval and continuation APIs.

## tool-calls

Status: implemented; browser dogfooding still needed.

Official example mirrored:

- Closest match: `cloudflare/agents/examples/dynamic-tools`
- Official model: `@cf/moonshotai/kimi-k2.6`
- Current dogfooding model: `@cf/google/gemma-4-26b-a4b-it`

Felt good:

- Dynamic client tool schemas fit naturally in `body: () => ({ clientTools: activeTools })`.
- `chat.pendingToolCalls` plus `toolCall.run(...)` works well for automatic browser-side tools.
- `toolCall.addOutput({ state: "output-error", errorText })` is understandable for disabled tools.
- Rendering tool parts directly from `chat.messages` is straightforward enough for a public example.

Felt awkward:

- `autoContinueAfterToolResult: false` with `sendAutomaticallyWhen` is more subtle than the default continuation path. It is expressible without adding a chat-level helper, but the example should be tested in a browser before deciding whether the docs need more explanation.
- The example needs real browser testing to confirm the model calls tools reliably with Gemma.

API changes to consider:

- None yet. Revisit after browser testing the full tool-call loop.

Docs needed:

- Explain that client tools are sent as serializable schemas in the request body and executed in the browser through `toolCall.run(...)`.
- Keep official-example parity notes in dogfooding docs, not public example UI.
