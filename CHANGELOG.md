# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project attempts to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
## [${version}]
### Added - for new features
### Changed - for changes in existing functionality
### Deprecated - for soon-to-be removed features
### Removed - for now removed features
### Fixed - for any bug fixes
### Security - in case of vulnerabilities
[${version}]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v${version}
-->

## [Unreleased]

### Added

- Added `chat.activity` and `chat.isBusy` as the primary Svelte chat activity API.
- Added `chat.isRecovering` for Cloudflare Agents durable-turn recovery hints.
- Added the `AgentToolInterruptedReason` type export from `agents-svelte/chat`.

### Changed

- Updated Cloudflare Agents SDK package requirements to `agents@^0.15.0`, `@cloudflare/ai-chat@>=0.8.4`, and `@cloudflare/voice@>=0.2.1`.
- Aligned AI SDK dependencies so the workspace resolves a single `ai` type graph.
- Refreshed development and example build tooling dependencies.
- Derived chat busy/streaming convenience getters from a single activity model instead of independent mutable flags; `chat.isBusy` covers broad "turn in progress" UI disabling, including recovery.
- Narrowed `chat.isStreaming` so pending client tool prompts are busy but not streaming until client-side tool work is running; active streams and tool continuations still count as streaming.
- Updated examples to require the synced Cloudflare Agents package versions.
- Delayed `VoiceAgent({ enabled: false })` client construction until the controller is enabled, matching upstream `enabled` behavior.

### Fixed

- Surface terminal chat recovery errors delivered through the stream resume handshake.
- Preserve `reason` and `childStillRunning` on interrupted Agent tool run state.
- Keep identified chat recovery active when an unrelated stream finishes.
- Allow `VoiceAgent` to retry after a failed lazy connection attempt.

## [0.3.0]

### Added

- Added `agent.ready`, `onIdentity`, `onIdentityChange`, and RPC `{ timeout, stream }` options to the Agent controller.
- Added `chat.isToolContinuation` for distinguishing tool continuation streams from new user submissions.

### Changed

- Updated Cloudflare Agents SDK packages to `agents@0.13.0` and `@cloudflare/ai-chat@0.7.1`.
- Matched upstream chat initial-message behavior so late history hydration preserves optimistic sends while socket-pushed snapshots remain authoritative.
- Expanded `chat.isStreaming` to include pending client-side tool calls and tool continuations.

### Fixed

- Mark denied tool approvals as `output-denied` locally.
- Avoid duplicate upstream identity-change warnings from the wrapped Agent client.

## [0.2.0]

### Added

- Added `cancelOnClientAbort` to `createAgentChat`.
- Added `enabled` support to `createVoiceAgent`.

### Changed

- Updated Cloudflare Agents SDK packages to `agents@0.12.4`, `@cloudflare/ai-chat@0.7.0`, and `@cloudflare/voice@0.2.0`.
- Matched upstream chat cleanup behavior: local cleanup does not cancel server turns by default, while `stop()` still cancels them.

## [0.1.0]

Initial release! 🎉

### Added

- Added Svelte 5 bindings for the Cloudflare Agents SDK.
- Added lifecycle-managed Agent controllers with reactive state, identity, query status, RPC calls, and stub access.
- Added Agent-backed AI chat with streaming responses, initial message loading, and browser-side tool calls.
- Added streamed tool event state for Agents-as-tools workflows.
- Added human-in-the-loop approval support for server-side and browser-resolved tools.
- Added voice agent and voice input controllers.
- Added SvelteKit SSR-safe controller creation.
- Added public examples for chat, multi-agent chat, tool calls, human-in-the-loop flows, Agents-as-tools, voice, and SvelteKit.
- Added README documentation.
- Added initial unit, type, and browser E2E tests.

[Unreleased]: https://github.com/joshuadavidthomas/agents-svelte/compare/v0.3.0...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v0.1.0
[0.2.0]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v0.2.0
[0.3.0]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v0.3.0
