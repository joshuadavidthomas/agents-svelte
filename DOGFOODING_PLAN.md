# Dogfooding plan for `@joshthomas/cloudflare-agents-svelte`

The package is technically close to publishable, but publishing should wait until the API has been used in real Svelte examples. The goal of this phase is to move the package into its own repo, build small examples, and verify that the Svelte-first API decisions feel good outside tests.

## Goals

- Extract `packages/agents-svelte/` into its own repository.
- Use local workspace/link installs for dogfooding.
- Build focused examples that each test one part of the public API.
- Record what feels good, what feels awkward, and what should change before publish.
- Publish only after the examples make the API feel boring and obvious.

## Repository target

Create a standalone repository:

```txt
github.com/joshthomas/cloudflare-agents-svelte
```

Suggested layout:

```txt
cloudflare-agents-svelte/
  src/
  examples/
  README.md
  package.json
  tsconfig.json
  DOGFOODING.md
```

After copying the package to the new repository, run:

```bash
npm install
npm run check
npm test
npm run pack:dry-run
```

Do not publish immediately.

## Local package workflow

Use the examples the way Cloudflare's monorepo examples do: as local workspace consumers during development. Cloudflare examples depend on local packages with `"agents": "*"`, `"@cloudflare/ai-chat": "*"`, `"@cloudflare/voice": "*"`, etc., and npm workspaces resolve those to the checked-out packages. They do not install packed tarballs for example development.

For this repo, use whatever local-development workflow is fastest:

- workspace dependencies such as `"@joshthomas/cloudflare-agents-svelte": "*"`
- `file:../..`
- `npm link`
- `pnpm link`
- `bun link`

The point of dogfooding examples is API feel, not npm-pack paranoia. Local linking is the right default while iterating.

`npm pack` is not part of dogfooding. Treat it as a final publish check only.

## Examples to build

Each example should answer one question: does this part of the API feel natural in a real Svelte app?

### 1. `examples/basic-chat`

Purpose: prove the core `Agent` + `AgentChat` happy path.

Features:

- connect to a server agent
- send messages
- stream assistant responses
- render `chat.messages`
- show `chat.isStreaming`
- call `chat.stop()`
- start a new chat with `chat.clearHistory()`
- show the model id used by the Worker
- show per-session estimated input/output tokens and cost after each agent turn

Use copy and layout that feel like the official Cloudflare examples. Do not expose internal dogfooding language in the app UI.

During dogfooding, prefer a cheap Workers AI model so the example can be used freely. Before publish, re-evaluate whether to switch to the same model as the current official Cloudflare example for parity.

Current dogfooding model:

```txt
@cf/google/gemma-4-26b-a4b-it
```

Official `cloudflare/agents/examples/ai-chat` currently uses:

```txt
@cf/moonshotai/kimi-k2.6
```

Validates:

- `createAgent(...)`
- `createAgentChat(...)`
- component lifecycle cleanup
- chat message rendering ergonomics
- source-only package consumption in a real Svelte/Vite app
- whether usage metadata from the provider is available through the Agents chat path
- whether fallback token/cost estimation is useful without distracting during streaming

Question to answer:

> Is `agent` + `chat` as two objects annoying, or does it feel correct because the agent connection is reusable?

### 2. `examples/stateful-agent`

Purpose: prove `Agent` alone is useful without chat.

Features:

- server agent with state, such as a counter, todos, or preferences
- client reads `agent.state`
- client calls server methods through `agent.call(...)` or `agent.stub`
- render `agent.connected`, `agent.identity`, and `agent.lastStateUpdate`

Validates:

- `Agent` as a Svelte reactive controller
- typed RPC ergonomics
- state sync semantics
- identity/connect lifecycle

Question to answer:

> Does this feel like a Svelte controller, or like a React hook wearing a class costume?

### 3. `examples/tool-calls`

Purpose: prove the main Svelte-first tool-call API decision.

Features:

- agent emits a client-side tool call
- UI lists `chat.pendingToolCalls`
- button calls `toolCall.run(...)`
- show `toolCall.running`, `toolCall.handled`, and `toolCall.lastError`
- test both success and error output paths
- include a variant with `autoContinueAfterToolResult: false`

Validates:

- handle-based tool-call API
- no chat-level `addToolOutput(...)`
- reactive tool-call state
- continuation semantics
- whether the API is understandable from usage alone

Question to answer:

> Does `toolCall.run(...)` feel like the one obvious Svelte way to do client tools?

If this example feels awkward, fix the package before publishing.

### 4. `examples/human-approval`

Purpose: prove approval UX.

Features:

- tool asks for approval
- UI shows approve/deny buttons
- approve/deny through pending tool-call handles
- duplicate clicks are harmless
- optionally include a manual explanation field

Validates:

- approval semantics
- pending tool-call filtering
- button-driven UI flow
- reactive state after approval/denial

Question to answer:

> Are approvals naturally expressed as UI state, or do hidden imperative seams remain?

### 5. `examples/voice-input`

Purpose: prove the dictation wrapper in an actual browser interaction.

Features:

- `createVoiceInput(...)`
- show transcript and interim transcript
- start/stop dictation
- clear transcript
- show audio level and mute state if useful

Validates:

- `VoiceInput` API
- `clear()` behavior in real UI
- whether eager connection is annoying
- whether custom transport support needs docs or examples

Question to answer:

> Does eager connection surprise me in a page that only starts listening after a button click?

This example should inform whether to keep eager voice connection or add an explicit connection option before publishing.

### 6. Optional: `examples/voice-agent`

Purpose: prove full conversational voice agent usage.

Features:

- `createVoiceAgent(...)`
- start/end call
- transcript display
- mute
- status/error display
- custom messages

This can wait. Browser microphone/audio setup can distract from the core package API.

## Example conventions

Each example should be independently runnable:

```bash
cd examples/basic-chat
npm install
npm run dev
```

Recommended structure:

```txt
examples/basic-chat/
  README.md
  package.json
  src/
    App.svelte
    worker.ts
  wrangler.jsonc
  vite.config.ts
  tsconfig.json
```

Keep examples small and focused. Do not build a playground yet. A playground hides API friction by wrapping it in too much app-specific structure.

## Official example mapping

These examples should feel like Svelte counterparts to Cloudflare's official examples, not internal demos.

| Svelte example            | Closest official Cloudflare example          | Notes                                                                                                                                               |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/basic-chat`     | `cloudflare/agents/examples/ai-chat`         | Official code currently uses `@cf/moonshotai/kimi-k2.6`; this repo may use cheaper Gemma during dogfooding.                                         |
| `examples/stateful-agent` | `cloudflare/agents/examples/multi-ai-chat`   | Official example has persisted chats and shared memory. For this package, keep the first stateful example smaller if it better tests `Agent` alone. |
| `examples/tool-calls`     | `cloudflare/agents/examples/dynamic-tools`   | Best match for client-provided tools and the Svelte tool-call handle API.                                                                           |
| `examples/human-approval` | `cloudflare/agents/guides/human-in-the-loop` | Best match for chat tool approval via `needsApproval`.                                                                                              |
| `examples/voice-input`    | `cloudflare/agents/examples/voice-input`     | STT-only dictation; no LLM prompt.                                                                                                                  |
| `examples/voice-agent`    | `cloudflare/agents/examples/voice-agent`     | Full conversational voice example; can wait until core chat/tool APIs feel good.                                                                    |

## Dogfooding notes

Create `DOGFOODING.md` in the standalone repo. For each example, record:

```md
## basic-chat

Felt good:

- ...

Felt awkward:

- ...

API changes to consider:

- ...

Docs needed:

- ...
```

Use these notes to decide whether to change the API before publishing.

## Questions to ask while dogfooding

### Agent lifecycle

- Do factories feel natural in Svelte components?
- Do direct classes feel clear for explicit lifetime control?
- Is eager connection okay?
- Is `close()` obvious enough?

### Chat

- Is `AgentChat` too much of a class, or does it feel like a Svelte controller?
- Is `pendingToolCalls` discoverable?
- Does `chat.isStreaming` cover what users expect?
- Does `clearHistory()` feel right?
- Does `getInitialMessages` need a simpler story?

### Tools

- Is `toolCall.run(...)` enough?
- Do users need manual `toolCall.addOutput(...)` often?
- Is error handling obvious?
- Does `lastError` need more structure?

### Voice

- Does eager connection feel wasteful?
- Should `VoiceInput` have explicit `connect()` / `disconnect()`?
- Is `clear()` semantics intuitive?
- Are per-property reactive getters enough?

### Packaging

- Do examples build against the tarball?
- Do root, `/chat`, and `/voice` imports work?
- Does source-only Svelte package consumption cause Vite/SvelteKit trouble?
- Do peer dependencies make installs annoying?

## Publishing gate

Publish only after:

- standalone package validation passes
- at least these examples exist and run:
    - `basic-chat`
    - `tool-calls`
    - `voice-input`
- `DOGFOODING.md` has no unresolved “this API feels wrong” notes
- README matches what the examples teach
- final publish checks pass, including `npm pack --dry-run`

A good publish criterion:

> I can point someone to `examples/basic-chat` and `examples/tool-calls`, and they can understand the package without me narrating the design history.

## Immediate plan

1. Extract `packages/agents-svelte/` to the standalone repo.
2. Commit the package as-is.
3. Add `examples/basic-chat`.
4. Add `examples/tool-calls`.
5. Add `examples/voice-input`.
6. Re-evaluate:
    - eager voice connection
    - tool-call ergonomics
    - source-only packaging
7. Publish `0.1.0` only after dogfooding confirms the API.
