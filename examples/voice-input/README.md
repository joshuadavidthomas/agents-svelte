# Voice input

Svelte dictation app using `createVoiceInput(...)` from `agents-svelte/voice`.

Speech is streamed to a Cloudflare Agent, transcribed with Workers AI Nova 3 STT, and rendered as reactive Svelte state.

## What it demonstrates

- `createVoiceInput({ agent: "VoiceInputAgent" })`
- Reactive `voice.transcript` and `voice.interimTranscript`
- Listening, mute, audio-level, error, copy, and clear UI state
- Server-side `withVoiceInput(Agent)` with `WorkersAINova3STT`

## Cloudflare setup

The Worker uses Workers AI for speech-to-text. If you are already logged in, you can skip the login command below.

## Run locally

Clone this repository, then run from this example directory:

```bash
pnpm install
pnpm exec wrangler login
pnpm run dev
```

Open the local Vite URL and click **Dictate**. The browser will ask for microphone permission.

Localhost is allowed for microphone testing. For deployed apps, serve over HTTPS and test microphone permissions in your target browsers.

## Try it

- Click **Dictate** and allow microphone access.
- Speak a sentence and watch final and interim transcript text update.
- Toggle mute while listening.
- Copy or clear the transcript.

## Build

```bash
pnpm run build
```

## Deploy

```bash
pnpm run build
pnpm exec wrangler deploy
```
