# API coverage

This file tracks how the public API is proved before publish: runtime tests, type tests, examples, and README coverage.

| API                       | Runtime tests                                                                                                       | Type tests                                                            | Example usage                                                                | Docs        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| `Agent`                   | `src/tests/createAgent*.test.ts`, `src/tests/factoryLifecycle.svelte.test.ts`                                       | `src/tests-d/public-api.test-d.ts`                                    | `examples/multi-ai-chat`, direct class lifetime                              | `README.md` |
| `createAgent`             | `src/tests/createAgent*.test.ts`, SSR/lifecycle harnesses                                                           | `src/tests-d/public-api.test-d.ts`                                    | basic chat, human-in-the-loop, multi AI chat, SvelteKit chat                 | `README.md` |
| `AgentChat`               | `src/tests/createAgentChat.svelte.test.ts`, factory lifecycle tests                                                 | `src/tests-d/public-api.test-d.ts`, `src/tests-d/chat-api.test-d.ts`  | `examples/multi-ai-chat`, direct class lifetime                              | `README.md` |
| `createAgentChat`         | `src/tests/createAgentChat.svelte.test.ts`, factory lifecycle tests                                                 | `src/tests-d/public-api.test-d.ts`                                    | basic chat, human-in-the-loop, tool-calls, SvelteKit chat                    | `README.md` |
| `AgentChatToolCall`       | pending tool-call, output, run, error, and approval tests in `src/tests/createAgentChat.svelte.test.ts`             | `src/tests-d/chat-api.test-d.ts`                                      | human-in-the-loop and tool-calls examples                                    | `README.md` |
| `getAgentMessages`        | fetch success, HTTP failure, parse failure, and network failure tests in `src/tests/createAgentChat.svelte.test.ts` | `src/tests-d/public-api.test-d.ts`                                    | used through default `AgentChat` initial loading                             | `README.md` |
| `AgentToolEvents`         | `src/tests/agentToolEvents.svelte.test.ts`, socket replacement test in `src/tests/factoryLifecycle.svelte.test.ts`  | `src/tests-d/public-api.test-d.ts`, `src/tests-d/chat-api.test-d.ts`  | `examples/multi-ai-chat` displays tool event runs beside matching tool calls | `README.md` |
| `createAgentToolEvents`   | lifecycle/reattach harness in `src/tests/factoryLifecycle.svelte.test.ts`                                           | `src/tests-d/public-api.test-d.ts`, `src/tests-d/chat-api.test-d.ts`  | README setup example                                                         | `README.md` |
| `VoiceAgent`              | `src/tests/createVoiceAgent.svelte.test.ts`, default transport tests                                                | `src/tests-d/public-api.test-d.ts`, `src/tests-d/voice-api.test-d.ts` | `examples/voice-agent`                                                       | `README.md` |
| `createVoiceAgent`        | SSR/factory lifecycle tests                                                                                         | `src/tests-d/public-api.test-d.ts`                                    | README setup example                                                         | `README.md` |
| `VoiceInput`              | `src/tests/createVoiceInput.svelte.test.ts`                                                                         | `src/tests-d/public-api.test-d.ts`, `src/tests-d/voice-api.test-d.ts` | `examples/voice-input`                                                       | `README.md` |
| `createVoiceInput`        | SSR/factory lifecycle tests                                                                                         | `src/tests-d/public-api.test-d.ts`                                    | `examples/voice-input`                                                       | `README.md` |
| `WebSocketVoiceTransport` | default transport behavior in `src/tests/createVoiceDefaultTransport.svelte.test.ts`                                | `src/tests-d/public-api.test-d.ts`                                    | used implicitly by `VoiceAgent`/`VoiceInput` defaults                        | `README.md` |

## Coverage rules

- Every exported value must appear in the public export assertions in `src/tests-d/public-api.test-d.ts`.
- Every exported value should have at least one runtime test unless it is a pure re-export from an upstream package.
- Primary Svelte factory APIs should appear in examples or README code.
- Direct classes should be tested for explicit `.connect()`/`.close()` lifetime control.
- Example code should demonstrate public behavior without exposing internal testing language.
