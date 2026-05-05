# Prepublish Plan

Goal: get `agents-svelte` ready for a first public publish with a small, reliable Svelte API, clean docs, and behavior close enough to the upstream Cloudflare Agents SDK where users can observe it.

## Completed fixes

- `getAgentMessages` now throws fetch/HTTP/parse failures so `chat.initialLoadError` matches the documented API.
- Example `tsconfig.json` files now set `noEmit`, so workspace example checks run without `allowImportingTsExtensions` warnings.
- `Agent` now passes normalized hosts to both PartySocket and HTTP URL generation, including protocol-prefixed hosts.
- Local-host protocol detection now handles hostnames without ports and uses numeric private IPv4 checks.
- `AgentChat.setMessages()` now no-ops after `close()`, matching the other mutators.
- Public docs were rewritten around the user-facing Svelte API and consistent example setup/validation/deploy sections.
- The SvelteKit example now documents runtime `PUBLIC_AGENT_HOST` configuration instead of build-only env assignment.

## Must fix before publish

1. Fix cross-tab broadcast replay parity.

    The Svelte chat path forwards replay chunks directly through `broadcastTransition`. Upstream React tracks pending replay request IDs and resets matching hydrated assistant messages before applying replay.

    Risk: a second tab opened during an active stream can show duplicate or stale assistant content.

    Files:
    - `src/chat-transport.ts`
    - `src/chat.svelte.ts`
    - upstream reference: `~/projects/cloudflare/agents/packages/ai-chat/src/react.tsx`

2. Commit the pnpm migration files.

    Include:
    - `pnpm-lock.yaml`
    - `pnpm-workspace.yaml`
    - deleted `package-lock.json` files
    - updated root and example `package.json` files

## Should fix soon

These are not launch blockers for an experimental `0.1.0`, but they are worth addressing before the API settles.

1. Add upstream-style async query lifecycle support.

    React supports cache TTL, refresh on disconnect, query deps, and Suspense. The Svelte adapter currently passes `query` straight to PartySocket.

    Risk: stale auth tokens on reconnect.

2. Add a Svelte equivalent of `useAgentToolEvents`.

    Upstream exposes sub-agent tool run events. This matters most for multi-agent chat patterns.

3. Rework `AgentChat.pendingToolCalls` toward derived state.

    It is currently maintained by an internal effect from `messages`. A more idiomatic Svelte design would derive pending tool calls from `messages`, with a small cache only if object identity needs to be preserved.

4. Improve example usage derivation.

    Several examples use `$state + $effect` for usage totals that are pure functions of `chat.messages`. Prefer `$derived.by(...)` unless intentionally storing a completed-stream snapshot.

5. Clarify or remove local-only approval `reason`.

    `addToolApprovalResponse({ reason })` applies `reason` locally, but the wire protocol does not send it. Server updates may overwrite it.

## Keep as-is

- `nanoid` is justified. Runtime chat code uses it, and upstream Cloudflare chat transport also uses `nanoid(8)` for request IDs.
- Dependency placement is right: `nanoid` is a runtime dependency; framework/protocol packages are peer dependencies with dev dependencies for tests/examples.
- Public exports are intentionally small.
- SSR construction is covered.
- Published tarball contents are clean.

## Validation before publish

Run from the repository root:

```bash
pnpm run check
pnpm test
pnpm -r --if-present run check
pnpm -r --if-present run build
pnpm pack --dry-run
```

Also verify a temporary consumer app can install the packed tarball and build with Vite.
