# agents-svelte

Svelte 5 bindings for the [Cloudflare Agents SDK](https://github.com/cloudflare/agents).

`agents-svelte` gives Svelte apps lifecycle-managed controllers for Agent state, typed RPC, AI chat, tool events, and voice. It is a community package, not an official Cloudflare package, and the API may change before `1.0`.

## Installation

```bash
pnpm add agents-svelte
```

For chat:

```bash
pnpm add @ai-sdk/svelte @cloudflare/ai-chat
```

For voice:

```bash
pnpm add @cloudflare/voice
```

Use this package from a Svelte 5 app built with Vite or another toolchain that supports `.svelte.ts` files.

## Quick start

Use factories inside Svelte components. They return reactive controllers immediately, connect after browser mount, and close automatically on component destroy.

This example assumes your Svelte app and Agent Worker share the same host and `/agents/*` routing.

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

## Usage

### Worker setup

The Svelte controllers connect to Agent routes served by a Cloudflare Worker. Every Agent Worker needs an Agent class, `routeAgentRequest(...)`, a Durable Object binding, and a migration.

A minimal chat Agent looks like this:

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { convertToModelMessages, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

type Env = {
  AI: Ai;
  ChatAgent: DurableObjectNamespace<ChatAgent>;
};

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it"),
      messages: await convertToModelMessages(this.messages),
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

Add the AI binding, Durable Object binding, and migration to `wrangler.jsonc`:

```jsonc
{
  "name": "chat-agent",
  "main": "src/server.ts",
  "compatibility_date": "2026-04-25",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI", "remote": true },
  "durable_objects": {
    "bindings": [{ "name": "ChatAgent", "class_name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
}
```

### Controller lifecycle

Each module exports a factory and a class. Use factories during component setup. They defer sockets, HTTP requests, voice transports, and browser APIs until `onMount(...)`, then call `.close()` from `onDestroy(...)`.

Use classes directly only when you need explicit lifetime control, such as outside component setup or when rebuilding a controller after options change:

```ts
import { Agent } from "agents-svelte";

const agent = new Agent({ agent: "ChatAgent", host: "localhost:8787" });
agent.connect();

// later
agent.close();
```

Classes do not connect automatically. Direct class users must call `.connect()` before operations that need a connection and `.close()` when done.

### Agent state and RPC

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

Read `agent.state`, `agent.connected`, and `agent.identity` directly in markup. Use `agent.setState(...)` for state updates and `agent.stub` or `agent.call(...)` for RPC.

Notes:

- The primary readiness signal is `agent.identity.identified`.
- State and identity transitions are reactive fields, not constructor callbacks.
- `agent.socket` is `null` before `.connect()` and after explicit `.close()`.
- Passing `agent: "ChatAgent"` is normalized to the route segment `chat-agent`.

#### Async query params

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

For async query functions, `Agent` waits for the query to resolve before opening the socket and refreshes query params after disconnects so reconnects do not reuse stale tokens. Call `agent.refreshQuery()` when an external auth source changes outside Svelte reactivity.

### Chat

`AgentChat` extends `@ai-sdk/svelte`'s `Chat` class and uses the Cloudflare Agents chat WebSocket protocol for history, streaming, tools, approvals, and resume.

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

Read `chat.messages`, `chat.status`, `chat.error`, and `chat.isStreaming` directly in markup. Use `chat.sendMessage(...)`, `chat.stop()`, `chat.clearHistory()`, and `chat.addToolApprovalResponse(...)` from event handlers.

Tool call handles expose `toolName`, `input`, `addOutput(...)`, and `run(...)`. Repeated `run(...)` calls share the same in-flight execution.

For AI SDK approval parts, resolve the approval with `chat.addToolApprovalResponse(...)`.

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

#### Initial messages

By default, `AgentChat` loads `/get-messages` from the Agent route. Use these options to override that behavior:

- `initialMessages` seeds the client before a fetch completes.
- `getInitialMessages: null` disables the default fetch.
- `getInitialMessages: async (...) => messages` supplies a custom loader.

#### Client tool schemas

Use `clientTools` when the browser should advertise tool schemas to the Agent. Execution still happens through `chat.pendingToolCalls`.

```svelte
<script lang="ts">
  const chat = createAgentChat({
    agent,
    clientTools: () => [
      {
        name: "getLocation",
        description: "Get the user's current location.",
        parameters: { type: "object", properties: {} }
      }
    ]
  });
</script>
```

On the server, use `createToolsFromClientSchemas(options.clientTools)` to expose those browser-provided schemas.

### Voice agent

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

Read `voice.status`, `voice.transcript`, `voice.interimTranscript`, `voice.audioLevel`, and `voice.isMuted` in markup. Use `voice.startCall()`, `voice.endCall()`, `voice.toggleMute()`, and `voice.sendText(text)` from event handlers.

### Voice input

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

Read `input.transcript`, `input.interimTranscript`, `input.isListening`, `input.audioLevel`, and `input.isMuted` in markup. Use `input.start()`, `input.stop()`, `input.toggleMute()`, and `input.clear()` from event handlers.

### SvelteKit

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

Pass `host` when browser code connects to an Agent Worker on another host, or when non-browser code calls `agent.getHttpUrl()` or `.connect()`.

## Examples

Clone the repository, install dependencies, and run an example:

```bash
pnpm install
cd examples/basic-chat
pnpm exec wrangler login
pnpm run dev
```

Available examples:

- `examples/basic-chat` — minimal AI chat app
- `examples/tool-calls` — browser-side tools with `chat.pendingToolCalls`
- `examples/multi-ai-chat` — inbox Agent with chat sub-agents and shared memory
- `examples/agents-as-tools` — parent tool calls that stream helper Agent runs with `createAgentToolEvents`
- `examples/human-in-the-loop` — server tool approvals and browser-resolved tools
- `examples/voice-input` — dictation-focused voice input
- `examples/voice-agent` — conversational voice agent
- `examples/sveltekit-chat` — SvelteKit SSR app connected to an Agent Worker

## License

agents-svelte is licensed under the MIT license. See [`LICENSE`](LICENSE) for more information.
