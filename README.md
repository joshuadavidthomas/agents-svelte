# agents-svelte

Svelte 5 bindings for the [Cloudflare Agents SDK](https://github.com/cloudflare/agents).

`agents-svelte` gives Svelte apps reactive controllers for Cloudflare Agents, AI chat, and voice. It is a community package, not an official Cloudflare package. The API is experimental and may change before `1.0`.

## What you get

- `createAgent(...)` for Agent state, identity, RPC, and WebSocket lifecycle
- `createAgentChat(...)` for AI SDK chat over the Cloudflare Agents chat transport
- `createVoiceAgent(...)` and `createVoiceInput(...)` for Cloudflare voice clients
- SSR-safe constructors for SvelteKit components
- Svelte 5 reactive fields instead of React hooks and callback-heavy APIs

This package ships source-only for now. Your app needs Svelte 5 tooling that can compile `.svelte.ts` files, such as Vite with `@sveltejs/vite-plugin-svelte`. TypeScript projects should use bundler-style module resolution.

## Install

For Agent state/RPC:

```bash
pnpm add agents-svelte agents partysocket svelte
```

For chat, also install:

```bash
pnpm add @ai-sdk/svelte @cloudflare/ai-chat ai
```

For voice, also install:

```bash
pnpm add @cloudflare/voice
```

## Quick start

Use factories inside Svelte components. They return reactive controllers immediately, connect after browser mount, and close automatically on component destroy.

```svelte
<script lang="ts">
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";

  const agent = createAgent({ agent: "ChatAgent", name: "default" });
  const chat = createAgentChat({ agent });

  let input = $state("");

  function send() {
    const text = input.trim();
    if (!text || chat.isStreaming) return;
    chat.sendMessage({ text });
    input = "";
  }
</script>

{#each chat.messages as message (message.id)}
  <article class={message.role}>
    {#each message.parts as part}
      {#if part.type === "text"}
        <p>{part.text}</p>
      {/if}
    {/each}
  </article>
{/each}

<form onsubmit={(event) => { event.preventDefault(); send(); }}>
  <input bind:value={input} />
  <button disabled={!input.trim() || chat.isStreaming}>Send</button>
</form>
```

## Modules

| Subpath               | Main exports                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `agents-svelte`       | `Agent`, `createAgent`                                                                        |
| `agents-svelte/chat`  | `AgentChat`, `AgentChatToolCall`, `createAgentChat`, `getAgentMessages`                       |
| `agents-svelte/voice` | `VoiceAgent`, `VoiceInput`, `createVoiceAgent`, `createVoiceInput`, `WebSocketVoiceTransport` |

## Lifecycle model

Each module exports a factory and a class.

Use factories during component setup:

```ts
const agent = createAgent({ agent: "ChatAgent" });
```

Factories register Svelte lifecycle hooks. They defer sockets, HTTP requests, voice transports, and browser APIs until `onMount(...)`, then call `.close()` from `onDestroy(...)`.

Use classes directly only when you need explicit lifetime control, such as outside component setup or when rebuilding a controller after options change:

```ts
import { Agent } from "agents-svelte";

const agent = new Agent({ agent: "ChatAgent", host: "localhost:8787" });
agent.connect();

// later
agent.close();
```

Class constructors are inert. Direct class users must call `.connect()` before operations that need a connection and `.close()` when done.

## `createAgent` / `Agent`

```svelte
<script lang="ts">
  import { createAgent } from "agents-svelte";

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
- `agent.queryStatus` — `"idle" | "loading" | "ready" | "error"`
- `agent.queryError`
- `agent.stateError`
- `agent.mcp`
- `agent.lastStateUpdate` — `{ state, source, seq } | null`
- `agent.lastIdentityChange` — `{ oldIdentity, newIdentity, seq } | null`

Methods:

- `agent.setState(next)`
- `agent.call(method, args?, streamOptions?)`
- `agent.stub` for typed RPC
- `agent.getHttpUrl()`
- `agent.refreshQuery()`
- `agent.connect()`
- `agent.close()`

Notes:

- The primary readiness signal is `agent.identity.identified`.
- State and identity transitions are reactive fields, not constructor callbacks.
- `agent.socket` is `PartySocket | null`. It is `null` before `.connect()` and after explicit `.close()`.
- Passing `agent: "ChatAgent"` is normalized to the route segment `chat-agent`.

### Async query params

Use `query` for connection params such as short-lived auth tokens:

```svelte
<script lang="ts">
  const agent = createAgent({
    agent: "ChatAgent",
    query: async () => {
      const userId = session.userId; // read reactive inputs before the first await
      const token = await getToken(userId);
      return { token };
    }
  });
</script>

{#if agent.queryStatus === "error"}
  <p>Could not prepare the Agent connection: {agent.queryError?.message}</p>
{/if}
```

For async query functions, `Agent` waits for the query to resolve before opening the socket, caches concurrent resolutions for five minutes by default, and refreshes query params after disconnects so reconnects do not reuse stale tokens. Set `cacheTtl` to change the cache lifetime. Call `agent.refreshQuery()` when an external auth source changes outside Svelte reactivity.

## `createAgentChat` / `AgentChat`

`AgentChat` extends `@ai-sdk/svelte`'s `Chat` class and uses the Cloudflare Agents chat WebSocket protocol. It adds initial-message loading, server history sync, stream resumption, cross-tab broadcast handling, and Svelte-friendly pending tool-call handles.

```svelte
<script lang="ts">
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";

  const agent = createAgent({ agent: "ChatAgent", name: "session-1" });
  const chat = createAgentChat({ agent });

  $effect(() => {
    for (const toolCall of chat.pendingToolCalls) {
      if (toolCall.toolName !== "getLocation") continue;

      void toolCall.run(async () => {
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject)
        );

        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      });
    }
  });
</script>
```

Reactive fields:

- `chat.messages`
- `chat.status`
- `chat.error`
- `chat.initialized`
- `chat.initialLoadError`
- `chat.pendingToolCalls`
- `chat.isServerStreaming`
- `chat.isStreaming`

Methods:

- `chat.sendMessage(...)`
- `chat.regenerate(...)`
- `chat.resumeStream(...)`
- `chat.stop()`
- `chat.addToolApprovalResponse({ id, approved })`
- `chat.setMessages(next, { skipServerSync? })`
- `chat.clearHistory()`
- `chat.connect()`
- `chat.close()`

Pending tool call handles expose:

- `toolCall.toolCallId`
- `toolCall.toolName`
- `toolCall.messageId`
- `toolCall.input`
- `toolCall.running`
- `toolCall.handled`
- `toolCall.lastError`
- `toolCall.addOutput({ output })`
- `toolCall.addOutput({ state: "output-error", errorText })`
- `toolCall.run(async (input, toolCall) => output)`

`pendingToolCalls` is the current actionable queue from the latest assistant message. It is not a durable registry of every unresolved historical tool call. Keep manual UI tied to the `AgentChatToolCall` handle you received.

`toolCall.run(...)` is safe to call from `$effect(...)`: repeated effect runs and duplicate calls share the same in-flight execution. If the handler throws, the tool call sends an `output-error` result, records `lastError`, and is marked handled.

For manual UI, keep the handle in local state:

```svelte
<script lang="ts">
  import type { AgentChatToolCall } from "agents-svelte/chat";

  let picker = $state<AgentChatToolCall | null>(null);

  $effect(() => {
    picker = chat.pendingToolCalls.find((toolCall) => toolCall.toolName === "pickFile") ?? null;
  });
</script>

{#if picker}
  <button onclick={() => picker?.addOutput({ output: { path: "/tmp/a.txt" } })}>
    Use file
  </button>
{/if}
```

For AI SDK approval parts, resolve the approval with `chat.addToolApprovalResponse(...)`. The Cloudflare approval wire protocol sends `toolCallId`, `approved`, and continuation metadata.

```svelte
{#each chat.messages as message}
  {#each message.parts as part}
    {#if "approval" in part && part.approval && part.state === "approval-requested"}
      <button onclick={() => chat.addToolApprovalResponse({ id: part.approval.id, approved: true })}>
        Approve
      </button>
      <button onclick={() => chat.addToolApprovalResponse({ id: part.approval.id, approved: false })}>
        Deny
      </button>
    {/if}
  {/each}
{/each}
```

### Initial messages

By default, `AgentChat` loads `/get-messages` from the Agent route. Use these options to override that behavior:

- `initialMessages` seeds the client before a fetch completes.
- `getInitialMessages: null` disables the default fetch.
- `getInitialMessages: async (...) => messages` supplies a custom loader.

If the loader fails, `chat.initialLoadError` is set and `chat.initialized` still becomes `true`.

### Tool continuation

By default, `autoContinueAfterToolResult` is `true`: after tool results and approvals, the server continues the conversation and the client resumes that continuation.

Set `autoContinueAfterToolResult: false` when you want client-side continuation instead. In that mode, `AgentChat` uses the AI SDK's `sendAutomaticallyWhen` option after `toolCall.addOutput(...)` and `chat.addToolApprovalResponse(...)`.

## `createVoiceAgent` / `VoiceAgent`

`VoiceAgent` wraps `@cloudflare/voice` with Svelte reactive getters. It uses `WebSocketVoiceTransport` by default and accepts a custom `transport` when needed.

```svelte
<script lang="ts">
  import { createVoiceAgent } from "agents-svelte/voice";

  const voice = createVoiceAgent({ agent: "MyVoiceAgent" });
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
- `voice.connect()`
- `voice.close()`

## `createVoiceInput` / `VoiceInput`

`VoiceInput` is the dictation-focused voice wrapper. It exposes accumulated user transcript text and interim transcript text.

```svelte
<script lang="ts">
  import { createVoiceInput } from "agents-svelte/voice";

  const input = createVoiceInput({ agent: "VoiceInputAgent" });
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
- `input.connect()`
- `input.close()`

## SvelteKit usage

Controllers are browser-session objects. You can create them during SvelteKit component setup because factories do not open sockets, fetch history, start voice transports, or touch browser-only APIs until mount.

Do not create long-lived controllers in `+page.server.ts`, `+layout.server.ts`, or shared module scope. Server load functions should return serializable data, and components should create the controller for the browser session.

```svelte
<script lang="ts">
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";

  let { data } = $props();

  const agent = createAgent({ agent: "ChatAgent", name: data.threadId });
  const chat = createAgentChat({
    agent,
    initialMessages: data.messages,
    getInitialMessages: null
  });
</script>
```

If you use classes directly in SvelteKit components, connect them from browser-only lifecycle code:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Agent } from "agents-svelte";

  const agent = new Agent({ agent: "ChatAgent" });

  onMount(() => agent.connect());
  onDestroy(() => agent.close());
</script>
```

`agent.getHttpUrl()` and explicit `.connect()` still need a host when called outside the browser. Pass `host` if you call them from non-browser code.

## Examples

The examples are part of this repository and use pnpm workspaces.

```bash
pnpm install
pnpm --dir examples/basic-chat run dev
```

Available examples:

- `examples/basic-chat` — minimal AI chat app
- `examples/tool-calls` — browser-side tools with `chat.pendingToolCalls`
- `examples/multi-ai-chat` — inbox Agent with chat sub-agents and shared memory
- `examples/human-in-the-loop` — server tool approvals and browser-resolved tools
- `examples/voice-input` — dictation-focused voice input
- `examples/voice-agent` — conversational voice agent with optional WebRTC/SFU path
- `examples/sveltekit-chat` — SvelteKit SSR app connected to an Agent Worker

## Differences from the React packages

This package aims for the same observable Cloudflare Agents behavior where it matters, but the API is Svelte-shaped.

- No hooks. Use controllers with reactive fields.
- No Suspense / `use()` initial-message flow. Read `chat.initialized` and `chat.initialLoadError`.
- No automatic reconnect when options change. Recreate the controller when connection options change.
- `AgentChat` chat IDs are route-based so construction is SSR-safe before a socket exists.
- Deprecated React chat options are not ported.
- Resolve client tools through `AgentChatToolCall` handles from `chat.pendingToolCalls`.
- `Chat.messages` is assigned directly. `chat.setMessages(...)` is an extra wrapper that also syncs to the server.

## Implementation note

`agents-svelte/chat` includes an adapted internal Agent chat transport based on `@cloudflare/ai-chat/src/ws-chat-transport.ts`. It owns the Cloudflare Agents chat wire protocol for this Svelte adapter so the public API can stay Svelte-shaped and independently publishable.
