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

[Unreleased]: https://github.com/joshuadavidthomas/agents-svelte/compare/v0.2.0...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v0.1.0
[0.2.0]: https://github.com/joshuadavidthomas/agents-svelte/releases/tag/v0.2.0
