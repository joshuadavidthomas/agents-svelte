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
- `AgentChat.pendingToolCalls` remains synchronized from `messages` while retaining reactive public tool-call handles; the derived-only version was rejected because it mutates handle `$state` during derivation.
- Public examples use explicit `completedUsage` snapshot state so usage/cost updates after a stream completes instead of ticking during streaming.
- Cross-tab/reconnect replay handling now tracks pending replay streams, clears hydrated assistant parts on replay start, drops stale replay chunks, and collapses duplicate replay text prefixes.
- `addToolApprovalResponse` no longer accepts a local-only `reason`; the public API now matches the Cloudflare approval wire protocol.
- Async Agent query params now resolve before socket creation, dedupe concurrent resolutions, expose reactive query status/errors, refresh on disconnect, and support TTL-based refresh without React-style dependency arrays.
- `AgentToolEvents` now provides a Svelte runes-class equivalent of upstream `useAgentToolEvents`, including grouped sub-agent runs, unbound runs, replay dedupe, reset, and socket reattach after Agent reconnect.
- The pnpm migration is committed, including `pnpm-lock.yaml`, `pnpm-workspace.yaml`, deleted `package-lock.json` files, and updated root/example package files.

## Must fix before publish

None currently tracked.

## Should fix soon

None currently tracked.

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
