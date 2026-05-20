---
description: Sync agents-svelte with upstream Cloudflare Agents SDK changes
argument-hint: "[target-ref|version|main] [scope|report-only]"
---

Sync this repository with upstream Cloudflare Agents SDK changes.

Arguments: `$ARGUMENTS`

Do the work end-to-end. Do not ask me to find files, identify versions, or decide obvious React-to-Svelte port details. Ask only if blocked by credentials/network, a dirty worktree conflict, or a public API decision remains ambiguous after applying this prompt and the repo AGENTS.md.

## Default target

- If arguments include a git ref, tag, SHA, branch, `main`, or package version, use that as the upstream target.
- If no target is given, sync to the latest published versions of:
  - `agents`
  - `@cloudflare/ai-chat`
  - `@cloudflare/voice`
- Also scan upstream `main` for relevant unreleased changes. Report them. Implement unreleased changes only when they are clear protocol/behavior fixes and do not require unpublished dependencies.
- If arguments include `report-only`, audit and report only. Do not edit files.

## Branch and safety

- Check branch and worktree first.
- Unless arguments include `no-branch` or `report-only`, create or switch to a feature branch before editing, named like `sync/cloudflare-agents-upstream-YYYYMMDD`.
- Preserve unrelated local changes. Do not overwrite dirty user work.

## Upstream

Canonical upstream: `https://github.com/cloudflare/agents`

Use a temporary clone or GitHub research. Do not vendor upstream code.

Compare these upstream areas first:

- `packages/agents/src/react.tsx`
- `packages/agents/src/client.ts`
- `packages/agents/src/index.ts`
- `packages/agents/src/chat/**`
- `packages/ai-chat/src/react.tsx`
- `packages/ai-chat/src/ws-chat-transport.ts`
- `packages/ai-chat/src/types.ts`
- `packages/voice/src/voice-react.tsx`
- `packages/voice/src/voice-client.ts`
- `packages/voice/src/voice.ts`
- `packages/*/package.json` exports
- `packages/*/CHANGELOG.md`
- `examples/ai-chat`
- `examples/multi-ai-chat`
- `examples/dynamic-tools`
- `examples/voice-input`
- `examples/voice-agent`
- relevant guides, especially human-in-the-loop/tool approval docs

If paths have moved, rediscover them with `rg` in the upstream repo.

## Local map

Map upstream behavior to this Svelte package:

- `useAgent` → `src/agent.svelte.ts`, `src/index.ts`
- `useAgentChat` → `src/chat.ts`, `src/chat.svelte.ts`
- chat transport/protocol → `src/chat-transport.ts`
- tool events/approvals → `src/tool-events.svelte.ts`
- voice hooks/client behavior → `src/voice.ts`, `src/voice.svelte.ts`
- public examples → `examples/*`
- tests → `src/tests`, `src/tests-d`, `src/e2e`
- docs/API examples → `README.md`

## Porting rules

Repo priorities win:

1. Best Svelte API
2. Same observable behavior as official Cloudflare/React examples where applicable
3. Public examples that feel like Svelte counterparts
4. Tests and docs updated to match

Port behavior, not React shape.

Prefer:

- Svelte 5 runes and reactive state
- factories/controllers with Svelte lifecycle ownership
- one obvious Svelte API
- clean breaks over compatibility unless user data or a stable public contract requires compatibility
- dependency-native types at boundaries

Do not preserve React artifacts:

- hooks-shaped APIs
- callback notification surfaces when reactive state is better
- promise readiness when reactive readiness is better
- Tailwind/Kumo/React component structure from examples
- dogfooding/internal-process copy in public docs or examples

## What to sync

Look for upstream changes in:

- wire protocol message names and payloads
- WebSocket lifecycle, reconnect, resume, cancel, and clear behavior
- Agent state sync
- RPC/call/stub behavior
- chat streaming and tool continuation behavior
- tool result/approval semantics
- voice input and voice agent state/events
- package exports and dependency ranges
- example-visible behavior and setup
- errors users can observe

Update local code, tests, examples, and docs together.

If an upstream change is React-only and has no Svelte behavioral equivalent, skip it and explain why.

## Dependencies

Use pnpm. If syncing published releases, update relevant package versions in `package.json`/lockfile.

Do not switch package managers.

## Validation

Run the strongest relevant validation you can:

- Always run `pnpm run check`
- Always run `pnpm test`
- If examples changed, run their `pnpm run check` and `pnpm run build`
- If SvelteKit example changed, also run its Wrangler dry-run deploy command from repo guidance
- If browser behavior changed and time allows, run relevant Playwright tests

Do not treat TypeScript compile-only checks as a substitute for the project gates.

## Final response

Summarize:

- upstream target/ref/package versions
- upstream files compared
- local files changed
- behavior synced
- upstream changes intentionally skipped, with reasons
- validation commands and results
- follow-ups, if any

Before finishing, audit that every implemented upstream behavior has either test coverage, example coverage, or a clear reason why validation was limited.
