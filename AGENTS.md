# AGENTS.md

Community Svelte adapter for the Cloudflare Agents SDK, published as `agents-svelte`.

This package provides Svelte 5 controllers for Agent state, typed RPC, AI chat, tool events, and voice. It is pre-1.0, so API quality and clear behavior matter more than preserving early port decisions.

## Working rules

- Read the relevant source, tests, and examples before changing behavior.
- Keep changes scoped to the user's request. Do not refactor unrelated code, rewrite unrelated docs, or change example behavior just because the file is open.
- Prefer existing project patterns over new abstractions or dependencies.
- Use `pnpm` for package commands.
- If a public API changes, update the matching tests, type tests, README sections, and examples.
- If docs or examples mention behavior or dependency versions touched by the task, keep those references accurate. Leave unrelated prose alone.

## API priorities

1. Best Svelte API.
2. Same observable behavior as the official Cloudflare Agents examples where applicable.
3. Examples that feel like Svelte counterparts to Cloudflare's examples.
4. Tests and docs updated to match the chosen API.

Do not preserve React-shaped API just for compatibility with the initial port. Behavior parity matters; hook/callback shape parity does not.

Prefer:

- reactive state over callback notification surfaces
- reactive readiness over promise-based readiness when Svelte can model it
- one obvious Svelte way to do something
- deleting transitional APIs instead of documenting them as secondary APIs
- imperative methods only for genuinely imperative operations

When evaluating an API, ask whether it belongs in the primary Svelte story, whether it provides behavior that cannot be expressed better another way, and whether it would feel natural if discovered first through an example.

## Upstream syncs

When asked to sync with Cloudflare's upstream `agents` repo, read and follow `.pi/prompts/sync.md`.

For upstream parity, compare behavior users can observe:

- lifecycle outcomes
- state synchronization
- streaming behavior
- tool execution behavior
- approval behavior
- voice behavior
- error handling
- user-visible semantics

Do not copy upstream React internals just because they use hooks, callbacks, promise readiness, Tailwind/Kumo, or React component libraries.

## Examples

Examples are API documentation. Keep them small, focused, and useful to copy.

- Match the closest official Cloudflare example in behavior and concepts.
- Use idiomatic Svelte component structure and scoped styles when useful.
- Avoid playground abstractions that hide API friction.
- Document required Cloudflare/Wrangler setup clearly.
- Prefer explicit local state for example-only UI concerns.

Current mappings:

| Example                      | Closest Cloudflare example                   |
| ---------------------------- | -------------------------------------------- |
| `examples/basic-chat`        | `cloudflare/agents/examples/ai-chat`         |
| `examples/multi-ai-chat`     | `cloudflare/agents/examples/multi-ai-chat`   |
| `examples/tool-calls`        | `cloudflare/agents/examples/dynamic-tools`   |
| `examples/human-in-the-loop` | `cloudflare/agents/guides/human-in-the-loop` |
| `examples/voice-input`       | `cloudflare/agents/examples/voice-input`     |
| `examples/voice-agent`       | `cloudflare/agents/examples/voice-agent`     |
| `examples/sveltekit-chat`    | SvelteKit SSR integration example            |

## Tests

Tests serve the design. The design does not serve the tests.

- Keep tests focused on observable behavior and parity.
- Rewrite or delete tests that enforce React-shaped or transitional APIs.
- Add coverage when changing shared behavior, public API, streaming, tool calls, approvals, voice, or reconnect logic.
- Do not keep bad public API just because existing tests mention it.

## Validation

For standalone package checks, run from the repository root:

```bash
pnpm run check
pnpm test
```

For `examples/basic-chat`, run:

```bash
pnpm --dir examples/basic-chat run check
pnpm --dir examples/basic-chat run build
```

For `examples/sveltekit-chat`, run:

```bash
pnpm --dir examples/sveltekit-chat run check
pnpm --dir examples/sveltekit-chat run build
pnpm --dir examples/sveltekit-chat exec wrangler deploy --dry-run
```

Add equivalent validation notes as new examples are created.
