# Voice agent

Svelte voice chat app backed by a Cloudflare Agent Durable Object.

The agent streams microphone audio to Workers AI, responds with generated speech, keeps conversation history, and can call tools for time, reminders, and weather.

The default WebSocket path needs only Workers AI. The optional WebRTC/SFU path requires Cloudflare Realtime SFU credentials.

## What it demonstrates

- `new VoiceAgent({ agent: "MyVoiceAgent" })` for explicit controller lifetime
- Switching the voice controller between WebSocket and WebRTC/SFU microphone input
- `voice.startCall()`, `voice.endCall()`, and `voice.toggleMute()`
- Sending typed text messages with `voice.sendText(...)`
- Reactive transcript, interim transcript, status, audio level, metrics, connection, and error state
- Server-side `withVoice(Agent)` with Workers AI STT, TTS, and LLM tools
- Example-local `/sfu/*` routes for Cloudflare Realtime SFU integration

## Cloudflare setup

The Worker uses Workers AI for speech-to-text, text generation, and text-to-speech. Log in before running the dev server:

```bash
pnpm exec wrangler login
```

For WebRTC/SFU mode, configure these Worker environment variables:

```txt
CLOUDFLARE_REALTIME_SFU_APP_ID
CLOUDFLARE_REALTIME_SFU_API_TOKEN
```

Without those credentials, the app disables the WebRTC/SFU option. The default WebSocket mode remains available.

## Run locally

```bash
pnpm install
pnpm run dev
```

Open the local Vite URL and click **Start Call**. The browser will ask for microphone permission.

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
