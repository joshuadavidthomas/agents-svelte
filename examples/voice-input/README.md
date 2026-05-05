# Voice Input

Svelte version of Cloudflare's [`voice-input`](https://github.com/cloudflare/agents/tree/main/examples/voice-input) example.

This example shows real-time voice-to-text dictation with `createVoiceInput` from `agents-svelte/voice`. Speech is streamed to a Cloudflare Agent, transcribed with Workers AI Nova 3 STT, and rendered as reactive Svelte state.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL and click **Dictate**. The browser will ask for microphone permission.

## What this demonstrates

- `createVoiceInput({ agent: "VoiceInputAgent" })`
- reactive `voice.transcript` and `voice.interimTranscript`
- listening, mute, audio-level, error, copy, and clear UI state
- server-side `withVoiceInput(Agent)` with `WorkersAINova3STT`

## Deploy

```bash
npm run build
npx wrangler deploy
```
