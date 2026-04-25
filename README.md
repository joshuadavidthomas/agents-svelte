# @joshthomas/cloudflare-agents-svelte

Community Svelte 5 bindings for the [Cloudflare Agents SDK](https://github.com/cloudflare/agents).

This package is not maintained by Cloudflare. It is intentionally **not** a hook-shaped port of the React API. It uses Svelte 5 idioms:

- `.svelte.ts` modules
- classes with reactive fields
- `createX(...)` factory helpers
- automatic cleanup via `onDestroy(...)` when created inside a component

## Status

Experimental. Ships source-only for now — the consumer's `vite-plugin-svelte` compiles the `.svelte.ts` files. The API may change before `1.0`.

## Install

```bash
npm install @joshthomas/cloudflare-agents-svelte agents partysocket svelte
```

For chat, also install:

```bash
npm install @ai-sdk/svelte @cloudflare/ai-chat ai
```

For voice, also install:

```bash
npm install @cloudflare/voice
```

## Modules

| Subpath                                      | Exports                                                                                       | Replaces                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@joshthomas/cloudflare-agents-svelte`       | `Agent`, `createAgent`                                                                        | `useAgent` from `agents/react`                                  |
| `@joshthomas/cloudflare-agents-svelte/chat`  | `AgentChat`, `AgentChatToolCall`, `createAgentChat`, `getAgentMessages`                       | `useAgentChat` from `agents/ai-react`                           |
| `@joshthomas/cloudflare-agents-svelte/voice` | `VoiceAgent`, `VoiceInput`, `createVoiceAgent`, `createVoiceInput`, `WebSocketVoiceTransport` | `useVoiceAgent`, `useVoiceInput` from `@cloudflare/voice/react` |

## Construction model

Each module exports:

- a **class** (`Agent`, `AgentChat`, `VoiceAgent`, `VoiceInput`)
- a **factory** (`createAgent`, `createAgentChat`, `createVoiceAgent`, `createVoiceInput`)

Use the factory in components:

```ts
const agent = createAgent({ agent: "ChatAgent" });
```

The factory registers `onDestroy(() => instance.close())` and must be called during component init.

Use the class directly outside component init or when you want explicit lifetime control:

```ts
const agent = new Agent({ agent: "ChatAgent" });
// later
agent.close();
```

## `createAgent` / `Agent`

```svelte
<script lang="ts">
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";

  type State = { count: number };

  const agent = createAgent<unknown, State>({
    agent: "CounterAgent",
    name: "room-1"
  });
</script>

<p>connected: {String(agent.connected)}</p>
<p>count: {agent.state?.count ?? "—"}</p>
<button onclick={() => agent.setState({ count: (agent.state?.count ?? 0) + 1 })}>
  +1
</button>
```

Reactive fields:

- `agent.state`
- `agent.identity` — `{ name, agent, identified }`
- `agent.connected`
- `agent.stateError`
- `agent.mcp`
- `agent.lastStateUpdate` — `{ state, source, seq } | null`
- `agent.lastIdentityChange` — `{ oldIdentity, newIdentity, seq } | null`

Methods:

- `agent.setState(next)`
- `agent.call(method, args?, streamOptions?)`
- `agent.stub` for typed RPC
- `agent.getHttpUrl()`
- `agent.close()`

### Notes

- There is no top-level `agent.identified` field anymore. Use `agent.identity.identified`.
- The primary readiness signal is `agent.identity.identified`, not a promise.
- State and identity transitions are exposed as reactive fields (`lastStateUpdate`, `lastIdentityChange`) instead of constructor callbacks.
- For raw socket events, use `agent.socket.addEventListener(...)` directly.

## `createAgentChat` / `AgentChat`

Wraps `@ai-sdk/svelte`'s `Chat` class with the Cloudflare Agents WebSocket transport, initial-message fetching, reactive tool-call handles, stream resumption, and cross-tab broadcast handling.

```svelte
<script lang="ts">
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat } from "@joshthomas/cloudflare-agents-svelte/chat";

  const agent = createAgent({ agent: "ChatAgent", name: "session-1" });
  const chat = createAgentChat({ agent });

  $effect(() => {
    for (const toolCall of chat.pendingToolCalls) {
      if (toolCall.toolName !== "getLocation") continue;

      void toolCall.run(async () => {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej)
        );
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
      });
    }
  });

  let input = $state("");
</script>

{#each chat.messages as message (message.id)}
  <div class={message.role}>
    {#each message.parts as part}
      {#if part.type === "text"}{part.text}{/if}
    {/each}
  </div>
{/each}

<form
  onsubmit={(e) => {
    e.preventDefault();
    chat.sendMessage({ text: input });
    input = "";
  }}
>
  <input bind:value={input} />
  <button disabled={chat.isStreaming}>Send</button>
</form>
```

`AgentChat` extends `@ai-sdk/svelte`'s `Chat`, so you read the normal chat API directly from the instance.

Reactive fields:

- `chat.messages`
- `chat.status`
- `chat.error`
- `chat.initialized`
- `chat.initialLoadError`
- `chat.pendingToolCalls` — current `input-available` tool calls from the latest assistant message
- `chat.isServerStreaming`
- `chat.isStreaming`

Methods:

- `chat.sendMessage(...)`
- `chat.regenerate(...)`
- `chat.resumeStream(...)`
- `chat.stop()`
- `chat.addToolApprovalResponse({ id, approved, reason? })`
- `chat.setMessages(next, { skipServerSync? })`
- `chat.clearHistory()`
- `chat.close()` — disposes listeners/effects, stops active streams, and makes retained tool-call handles no-op.

Pending tool call handles (`chat.pendingToolCalls`) expose:

- `toolCall.toolCallId`
- `toolCall.toolName`
- `toolCall.messageId`
- `toolCall.input`
- `toolCall.running`
- `toolCall.handled`
- `toolCall.lastError`
- `toolCall.addOutput({ output })` for a successful result, or `toolCall.addOutput({ state: "output-error", errorText })` for an error. Calling `toolCall.addOutput()` is a successful `undefined` output.
- `toolCall.run(async (input, toolCall) => output)`

`pendingToolCalls` is the current actionable queue from the latest assistant message. It is not a durable registry of every unresolved historical tool call. Keep manual or delayed UI flows tied to the `AgentChatToolCall` handle you received from `pendingToolCalls`.

`toolCall.run(...)` is safe to call from `$effect(...)`: repeated effect runs and duplicate calls share the same in-flight execution. If the handler throws, the tool call sends an `output-error` result, records `lastError`, and is marked handled.

To report a manual tool error, call:

```ts
toolCall.addOutput({ state: "output-error", errorText: "Permission denied" });
```

By default, `autoContinueAfterToolResult` is `true`: after tool results and approvals, the server continues the conversation and the client resumes that continuation. Set `autoContinueAfterToolResult: false` when you want client-side continuation instead. In that mode, `AgentChat` uses the AI SDK's `sendAutomaticallyWhen` option after `toolCall.addOutput(...)` and `chat.addToolApprovalResponse(...)`; return `true` to call `chat.sendMessage()` automatically, or return `false` and call `chat.sendMessage()` yourself.

`sendAutomaticallyWhen` is still the AI SDK's normal end-of-stream continuation hook. The extra `AgentChat` behavior only covers the case where `autoContinueAfterToolResult: false` means no server continuation stream will arrive after the tool result. In multi-tool turns, make `sendAutomaticallyWhen` return `true` only when the current assistant message has every tool output needed to continue. Keep the predicate pure and idempotent because it may be evaluated as tool outputs arrive.

For manual UI, pass the handle to the UI that will resolve it:

```svelte
<script lang="ts">
  import type { AgentChatToolCall } from "@joshthomas/cloudflare-agents-svelte/chat";

  let picker = $state<AgentChatToolCall | null>(null);

  $effect(() => {
    picker =
      chat.pendingToolCalls.find(
        (toolCall) => toolCall.toolName === "pickFile"
      ) ?? null;
  });
</script>

{#if picker}
  <button onclick={() => picker?.addOutput({ output: { path: "/tmp/a.txt" } })}>
    Use file
  </button>
{/if}
```

For AI SDK approval parts, resolve the approval with `chat.addToolApprovalResponse(...)`. The optional `reason` is reflected in local UI state; the current Cloudflare approval wire protocol sends only `toolCallId`, `approved`, and continuation metadata.

```svelte
{#each chat.messages as message}
  {#each message.parts as part}
    {#if "approval" in part && part.approval && part.state === "approval-requested"}
      <button
        onclick={() =>
          chat.addToolApprovalResponse({ id: part.approval.id, approved: true })}
      >
        Approve
      </button>
      <button
        onclick={() =>
          chat.addToolApprovalResponse({ id: part.approval.id, approved: false })}
      >
        Deny
      </button>
    {/if}
  {/each}
{/each}
```

Helpers exported from `@joshthomas/cloudflare-agents-svelte/chat`:

- `getAgentMessages(...)`

## `createVoiceAgent` / `VoiceAgent`

Voice bindings are class-based too. `VoiceAgent` reads directly from `VoiceClient` via Svelte's `createSubscriber(...)`, so it stays reactive without duplicating the underlying client state. Both voice controllers use `WebSocketVoiceTransport` by default and accept a custom `transport` option when you need to supply one.

```svelte
<script lang="ts">
  import { createVoiceAgent } from "@joshthomas/cloudflare-agents-svelte/voice";

  const voice = createVoiceAgent({ agent: "voice-agent" });
</script>

<p>status: {voice.status}</p>
<p>connected: {String(voice.connected)}</p>
<button onclick={() => voice.startCall()}>Start call</button>
<button onclick={() => voice.endCall()}>End call</button>
```

Reactive fields:

- `voice.status`
- `voice.transcript`
- `voice.interimTranscript`
- `voice.metrics`
- `voice.audioLevel`
- `voice.isMuted`
- `voice.connected`
- `voice.error`
- `voice.lastCustomMessage`

Methods:

- `voice.startCall()`
- `voice.endCall()`
- `voice.toggleMute()`
- `voice.sendText(text)`
- `voice.sendJSON(data)`
- `voice.close()`

## `createVoiceInput` / `VoiceInput`

`VoiceInput` is the dictation-focused wrapper. It exposes a single accumulated user transcript string and ignores assistant transcript text.

```svelte
<script lang="ts">
  import { createVoiceInput } from "@joshthomas/cloudflare-agents-svelte/voice";

  const input = createVoiceInput({ agent: "voice-input-agent" });
</script>

<textarea readonly value={input.transcript + (input.interimTranscript ? " " + input.interimTranscript : "")} />
<button onclick={() => (input.isListening ? input.stop() : input.start())}>
  {input.isListening ? "Stop" : "Dictate"}
</button>
```

Reactive fields:

- `input.transcript`
- `input.interimTranscript`
- `input.isListening`
- `input.audioLevel`
- `input.isMuted`
- `input.error`

Methods:

- `input.start()`
- `input.stop()`
- `input.toggleMute()`
- `input.clear()`
- `input.close()`

## SvelteKit usage

`Agent`, `AgentChat`, `VoiceAgent`, and `VoiceInput` are client-side controllers. Create them in browser-only component code, not in `+page.server.ts`, `+layout.server.ts`, or shared module code that runs during SSR.

For SvelteKit pages, prefer one of these patterns:

- create the controller in a client-only child component
- guard construction with SvelteKit's `browser` value
- intentionally disable SSR for a route that is fully client-driven

You can still load initial chat history with SvelteKit `load` and pass it into the client controller:

```svelte
<script lang="ts">
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat } from "@joshthomas/cloudflare-agents-svelte/chat";

  let { data } = $props();

  const agent = createAgent({ agent: "ChatAgent", name: data.threadId });
  const chat = createAgentChat({
    agent,
    initialMessages: data.messages,
    getInitialMessages: null
  });
</script>
```

Tool handlers that use browser APIs such as geolocation, camera, files, or clipboard belong in component `$effect(...)` blocks or user event handlers.

## What's intentionally different from the React versions

- **No Suspense / `use()` semantics for initial messages.** `AgentChat` exposes reactive `initialized` / `initialLoadError` state instead.
- **No automatic socket reconnect on option change.** Recreate the controller when connection options change.
- **Deprecated chat options dropped.** `toolsRequiringConfirmation`, `experimental_automaticToolResolution`, deprecated client-side `tools`/`AITool` config, and `addToolResult` are not ported.
- **No hook-shaped callback API for durable state or tool-call routing.** In Svelte you read reactive fields and observe them with `$effect(...)`.
- **No chat-level tool-output mutation API.** Resolve tool calls through the `AgentChatToolCall` handle from `chat.pendingToolCalls`.
- **`Chat.messages` is assigned, not `setMessages()`-d.** That's the `@ai-sdk/svelte` model. `AgentChat#setMessages(...)` is a wrapper that also syncs back to the server.

## Implementation note

`@joshthomas/cloudflare-agents-svelte/chat` includes an adapted internal Agent chat transport based on `@cloudflare/ai-chat/src/ws-chat-transport.ts`. It owns the Cloudflare Agents chat wire protocol for this Svelte adapter so the public API can stay Svelte-shaped and independently publishable.
