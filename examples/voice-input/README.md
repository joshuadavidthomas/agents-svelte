# Voice input

Svelte dictation app using `createVoiceInput(...)` from `agents-svelte/voice`.

Speech is streamed to a Cloudflare Agent, transcribed with Workers AI Nova 3 STT, and rendered as reactive Svelte state.

## What it demonstrates

- `createVoiceInput({ agent: "VoiceInputAgent" })`
- Reactive `voice.transcript` and `voice.interimTranscript`
- Listening, mute, audio-level, error, copy, and clear UI state
- Server-side `withVoiceInput(Agent)` with `WorkersAINova3STT`

## Cloudflare setup

The Worker uses Workers AI for speech-to-text. Log in before running the dev server:

```bash
pnpm exec wrangler login
```

## Run locally

```bash
pnpm install
pnpm run dev
```

Open the local Vite URL and click **Dictate**. The browser will ask for microphone permission.

## Validate

```bash
pnpm run check
pnpm run build
```

## Deploy

```bash
pnpm run build
pnpm exec wrangler deploy
```
