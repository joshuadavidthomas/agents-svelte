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
- `AgentChat.pendingToolCalls` is now derived from `messages` on read instead of synchronized through an internal effect.
- Public examples use explicit `completedUsage` snapshot state so usage/cost updates after a stream completes instead of ticking during streaming.
- Cross-tab/reconnect replay handling now tracks pending replay streams, clears hydrated assistant parts on replay start, drops stale replay chunks, and collapses duplicate replay text prefixes.

## Must fix before publish

1. Commit the pnpm migration files.

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

3. Clarify or remove local-only approval `reason`.

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
