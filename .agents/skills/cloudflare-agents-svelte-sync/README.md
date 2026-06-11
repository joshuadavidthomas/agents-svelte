# Cloudflare Agents Svelte Sync Skill

## Purpose

Project-specific sync playbook for this repository when comparing against `cloudflare/agents`.

## Sources

- User sync prompt from 2026-06-11.
- Repository `AGENTS.md` public API, examples, and validation guidance.
- Session learning from syncing published versions `agents@0.15.0`, `@cloudflare/ai-chat@0.8.4`, `@cloudflare/voice@0.2.1` while upstream `main` had unreleased fixes.

## Key captured nuance

When upstream package versions are not bumped, do not bump this repo's dependencies. Carry only clear unreleased protocol/behavior fixes that need no unpublished dependency, test them locally, and report them as unreleased follow-ups for the next published sync.

## Changelog

- 2026-06-11: Initial repo-local skill created from the upstream sync prompt and unreleased errored-stream replay porting session.
