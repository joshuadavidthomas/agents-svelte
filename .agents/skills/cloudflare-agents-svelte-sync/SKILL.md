---
name: cloudflare-agents-svelte-sync
description: Use when syncing this agents-svelte repository with upstream Cloudflare Agents SDK packages — compares cloudflare/agents releases and main, ports React/AI Chat/Voice behavior into Svelte, handles unreleased upstream fixes, dependency bump decisions, examples, tests, and validation. Triggers on “sync with upstream Cloudflare Agents”, “update agents-svelte from cloudflare/agents”, Agents SDK upstream changes, ai-chat/voice package syncs, and React-to-Svelte port parity work in this repo.
---

# Cloudflare Agents Svelte Sync

Use this skill when syncing with upstream `https://github.com/cloudflare/agents`.

The job is to keep `agents-svelte` behavior-compatible with the official packages while preserving the better Svelte API. Port behavior, not React shape.

## Start

1. Read this repo's `AGENTS.md` first. Its API, examples, copy, and validation rules win.
2. Check safety before edits:
   - `jj st`
   - current bookmark/change context
   - dirty unrelated changes
3. Unless the user says `report-only` or `no-branch`, create/use a dated bookmark like `sync/cloudflare-agents-upstream-YYYYMMDD` before editing.
4. Use a temporary upstream clone or GitHub research. Do not vendor upstream code.

Ask only when blocked by credentials/network, a dirty worktree conflict, or a public API decision remains ambiguous after applying repo guidance.

## Choose the Target

| User input                                                    | Target                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| git ref, tag, SHA, branch, `main`, or package version present | Use that upstream target.                                                                                 |
| no target                                                     | Use latest published `agents`, `@cloudflare/ai-chat`, and `@cloudflare/voice`; also scan upstream `main`. |
| `report-only`                                                 | Audit and report only; do not edit.                                                                       |

Default published-version check:

```bash
pnpm view agents version
pnpm view @cloudflare/ai-chat version
pnpm view @cloudflare/voice version
```

## Published vs Unreleased Rule

This repo may already be on the latest published versions while upstream `main` contains extra commits whose package versions are not bumped yet.

When upstream versions are not bumped:

- Do not bump this repo's dependencies or lockfile just to track unreleased commits.
- Do port unreleased changes only when they are clear protocol/behavior fixes and require no unpublished dependency.
- Cover carried unreleased behavior with local tests, examples, or a clear validation note.
- Report the upstream commit/ref and say it is unreleased.
- When upstream later publishes, perform the normal dependency/lockfile sync and verify the local carried behavior still matches.

Skip unreleased changes that are server-internal, React-only, example styling/copy churn, codemode/think-only, or require unpublished package code.

## Compare These Upstream Areas First

Prefer exact upstream files; if paths moved, rediscover with `rg` in the upstream clone.

- `packages/agents/src/react.tsx`
- `packages/agents/src/client.ts`
- `packages/agents/src/index.ts`
- `packages/agents/src/chat/**`
- `packages/ai-chat/src/react.tsx`
- `packages/ai-chat/src/ws-chat-transport.ts`
- `packages/ai-chat/src/types.ts`
- `packages/ai-chat/src/index.ts`
- `packages/voice/src/voice-react.tsx`
- `packages/voice/src/voice-client.ts`
- `packages/voice/src/voice.ts`
- `packages/*/package.json` exports and peer/dependency ranges
- `packages/*/CHANGELOG.md` or changesets
- examples: `ai-chat`, `multi-ai-chat`, `dynamic-tools`, `voice-input`, `voice-agent`
- relevant docs/guides: resumable streaming, client tools, human-in-the-loop/tool approval, voice

## Local Map

| Upstream                     | Local Svelte surface                  |
| ---------------------------- | ------------------------------------- |
| `useAgent` / `agents/client` | `src/agent.svelte.ts`, `src/index.ts` |
| `useAgentChat`               | `src/chat.ts`, `src/chat.svelte.ts`   |
| chat transport/protocol      | `src/chat-transport.ts`               |
| tool events/approvals        | `src/tool-events.svelte.ts`           |
| voice hooks/client           | `src/voice.ts`, `src/voice.svelte.ts` |
| public examples              | `examples/*`                          |
| tests/types/e2e              | `src/tests`, `src/tests-d`, `src/e2e` |
| docs/API examples            | `README.md`                           |

## Porting Rules

Apply repo priorities in this order:

1. Best Svelte API.
2. Same observable behavior as official Cloudflare/React examples where applicable.
3. Public examples that feel like Svelte counterparts.
4. Tests and docs updated to match.

Prefer Svelte 5 runes, reactive state, lifecycle-owned factories/controllers, and one obvious Svelte API.

Do not preserve React artifacts:

- hooks-shaped APIs
- callback notification surfaces when reactive state is better
- promise readiness when reactive readiness is better
- Tailwind/Kumo/React component structure from examples
- dogfooding/internal-process copy in public docs/examples

Clean breaks are preferred over compatibility unless the user asks for migration, a stable public contract requires it, or existing user data depends on it.

## What Counts as Relevant

Look for user-observable changes in:

- wire protocol message names and payloads
- WebSocket lifecycle, reconnect, resume, cancel, clear behavior
- Agent state sync
- RPC/call/stub behavior
- chat streaming, recovery, replay, and continuation behavior
- client tool result/approval semantics
- voice input and voice agent state/events
- package exports and dependency ranges
- example-visible behavior and setup
- user-facing errors

If an upstream change is React-only and has no Svelte behavioral equivalent, skip it and explain why.

## Dependency Rules

- Use `pnpm`.
- If syncing published releases, update relevant package versions and lockfile.
- If carrying unreleased upstream behavior, do not bump dependency versions until upstream publishes.
- Do not switch package managers.

## Validation

Always run:

```bash
pnpm run check
pnpm test
```

If examples changed, run each changed example's:

```bash
pnpm run check
pnpm run build
```

For `examples/sveltekit-chat`, also run:

```bash
pnpm exec wrangler deploy --dry-run
```

If browser behavior changed and time allows, run relevant Playwright tests. If validation is blocked by Cloudflare credentials/API/network, record the command and failure.

Do not substitute TypeScript compile-only checks for project gates.

## Final Report

Summarize:

- upstream target/ref/package versions
- whether synced behavior is published or unreleased
- upstream files compared
- local files changed
- behavior synced
- upstream changes intentionally skipped, with reasons
- validation commands and results
- coverage audit: every implemented upstream behavior has test coverage, example coverage, or a clear reason validation was limited
- follow-ups, especially dependency bumps to perform once upstream publishes
