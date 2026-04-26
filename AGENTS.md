# AGENTS.md

Community Svelte adapter for the Cloudflare Agents SDK, published as `@joshthomas/cloudflare-agents-svelte`.

This repository is now public-facing. Treat examples, docs, README text, package metadata, and commit messages as material a user may read without context. Dogfooding notes are useful while developing, but the user-facing package should read like a real Svelte library, not an internal experiment.

The package is still pre-1.0 and experimental. API quality matters more than preserving early port decisions.

## Priority order

1. Best Svelte API
2. Same observable behavior as the official Cloudflare/React examples where applicable
3. Public examples that feel like Svelte counterparts to Cloudflare's examples
4. Tests and docs updated to match the better API

Do not invert this order.

## Public-facing framing

- Avoid internal-process framing in public files unless the file is explicitly an internal working note.
- `dogfooding` is acceptable in `DOGFOODING.md` and planning notes, but not in example UI copy, model prompts, public README prose, package metadata, or polished docs.
- Examples should explain what they demonstrate, not why we are testing them.
- Mirror Cloudflare example concepts and copy where helpful, but implement them in idiomatic Svelte.
- Use scoped Svelte styles when that makes the example clearer. Do not add Tailwind/Kumo just to mimic implementation details.
- Keep public copy boring, direct, and user-centered.

Temporary working docs:

- `DOGFOODING.md` and `DOGFOODING_PLAN.md` are working files for this phase and should be deleted before publish.
- `AGENTS.md` stays, but should be rewritten again before publish if the repository guidance changes.

## Public API standard

When evaluating a public API, ask:

- Is this part of the primary Svelte story?
- Does it provide unique behavior we cannot express better in Svelte?
- Would this API feel natural if discovered first through an example?

If the answer is no, remove or replace it now.

Do not:

- keep API around as a “secondary API”
- keep API “for compatibility” with the initial port
- keep API just to avoid rewriting tests
- apologize for bad API while leaving it public

A muddy exploratory API is worse than temporary test churn.

## Preferred design direction

- Prefer reactive state over callback notification surfaces.
- Prefer reactive state over promise-based readiness when Svelte can model readiness directly.
- Prefer one obvious Svelte way to do something.
- Prefer deleting transitional surfaces over documenting them as non-primary.
- Keep imperative methods only when the operation is genuinely imperative.

## Example guidance

Examples are public API documentation. They should be small, focused, and pleasant to copy.

For each example:

- match the closest official Cloudflare example in behavior and concepts
- use Svelte-native component structure and styling
- keep copy public-facing
- avoid playground abstractions that hide API friction
- document required Cloudflare/Wrangler setup clearly
- prefer explicit local state for example-only UI concerns
- do not encode dogfooding commentary in prompts or UI text

Current planned mappings:

| Example                   | Closest Cloudflare example                   |
| ------------------------- | -------------------------------------------- |
| `examples/basic-chat`     | `cloudflare/agents/examples/ai-chat`         |
| `examples/multi-ai-chat` | `cloudflare/agents/examples/multi-ai-chat`   |
| `examples/tool-calls`     | `cloudflare/agents/examples/dynamic-tools`   |
| `examples/human-approval` | `cloudflare/agents/guides/human-in-the-loop` |
| `examples/voice-input`    | `cloudflare/agents/examples/voice-input`     |
| `examples/voice-agent`    | `cloudflare/agents/examples/voice-agent`     |

## Parity guidance

Match official behavior where users can observe it:

- lifecycle outcomes
- state synchronization
- streaming behavior
- tool execution behavior
- approval behavior
- voice behavior
- error handling
- user-visible semantics

Do not match React just because:

- it uses hooks
- it uses callbacks
- it exposes promise-based readiness
- it has internal structure that is not Svelte-idiomatic
- it uses Tailwind/Kumo/React component libraries

API-shape parity does not matter. Behavior parity and example familiarity do.

## Tests

Tests serve the design. The design does not serve the tests.

- Rewrite or delete tests that enforce React-shaped or transitional API.
- Keep tests focused on observable behavior and parity.
- Add tests before or during refactors when they protect behavior we still care about.
- Do not keep bad public API just because existing tests mention it.

## Reduction guidance

Deletion is good when it improves the Svelte API or removes port artifacts.

Do not delete behaviorful code until the behavior is covered another way. Once behavior is preserved, prefer the smaller and clearer public surface.

## Validation

For standalone package checks, run from this repository root:

```bash
npm run check
npm test
npm run pack:dry-run
```

For `examples/basic-chat`, run:

```bash
cd examples/basic-chat
npm run check
npm run build
```

Add equivalent validation notes as new examples are created.
