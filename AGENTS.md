# AGENTS.md — packages/agents-svelte

Community Svelte adapter for the Cloudflare Agents SDK, being prepared for extraction as `@joshthomas/cloudflare-agents-svelte`.

Treat the package as pre-1.0 and experimental, but no longer as a throwaway port. API quality and extractability matter.

## Priority order

1. Best Svelte API
2. Same observable behavior as the React version
3. Tests and docs updated to match the better API

Do not invert this order.

## Exploration rules

- Breakage is expected and acceptable here.
- The only meaningful breakage is temporary test/doc churn while we improve the design.
- Do not preserve awkward API just because it existed in the initial port.
- Do not preserve React-shaped public surface unless it is clearly the best Svelte surface too.
- Behavior parity matters. API-shape parity does not.

## Public API standard for this package

When evaluating a public API, ask:

- Is this part of the primary Svelte story?
- Does it provide unique behavior we cannot express better in Svelte?

If the answer is no, remove or replace it now.

Do not:

- keep it around as a “secondary API”
- keep it “for compatibility” with the initial port
- keep it just to avoid rewriting tests
- apologize for bad API while leaving it public

A muddy exploratory API is worse than test failures.

## Preferred design direction

- Prefer reactive state over callback notification surfaces.
- Prefer reactive state over promise-based readiness when Svelte can model readiness directly.
- Prefer one obvious Svelte way to do something.
- Prefer deleting transitional surfaces over documenting them as non-primary.
- Keep imperative methods only when the operation is genuinely imperative.

## Tests

Tests serve the design. The design does not serve the tests.

- Rewrite or delete tests that enforce React-shaped or transitional API.
- Keep tests focused on observable behavior and parity.
- Add tests before or during refactors when they protect behavior we still care about.
- Do not keep bad public API just because existing tests mention it.

## Parity guidance

Match the React implementation in observable behavior:

- lifecycle outcomes
- state synchronization
- streaming behavior
- tool execution behavior
- error handling
- user-visible semantics

Do not match React just because:

- it uses hooks
- it uses callbacks
- it exposes promise-based readiness
- it has internal structure that is not Svelte-idiomatic

## Reduction guidance

Deletion is good when it improves the Svelte API or removes port artifacts.

Do not delete behaviorful code until the behavior is covered another way.
But once behavior is preserved, prefer the smaller and clearer public surface.

## Validation

Before considering changes done inside the Cloudflare monorepo, run:

```bash
npx oxfmt packages/agents-svelte
npx oxlint packages/agents-svelte
npx tsx scripts/typecheck.ts agents-svelte
cd packages/agents-svelte && npx vitest --run --config src/tests/vitest.config.ts
```

For standalone extraction checks, run from this package directory:

```bash
npm run check
npm test
npm run pack:dry-run
```

Repo-wide `npm run check` may still fail for unrelated pre-existing issues. Do not treat unrelated repo failures as blockers for this package.
