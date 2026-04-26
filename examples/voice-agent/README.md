# Voice Agent

Svelte version of Cloudflare's [`voice-agent`](https://github.com/cloudflare/agents/tree/main/examples/voice-agent) example.

Talk to an AI assistant backed by a Cloudflare Agent Durable Object. The agent streams microphone audio to Workers AI, responds with generated speech, keeps conversation history, and can call tools for time, reminders, and weather.

The default WebSocket path needs no external API keys beyond the Workers AI binding. The optional WebRTC/SFU path requires Cloudflare Realtime SFU credentials.

This Svelte example includes the default WebSocket voice-agent path and an advanced WebRTC/SFU transport option. The SFU code is intentionally example-local for now, with a forward-looking shape that could become a reusable Svelte voice transport API later.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL and click **Start Call**. The browser will ask for microphone permission.

## What this demonstrates

- `new VoiceAgent({ agent: "MyVoiceAgent" })` for explicit controller lifetime
- swapping the voice controller between WebSocket and WebRTC/SFU microphone input
- `voice.startCall()`, `voice.endCall()`, and `voice.toggleMute()`
- typed text messages with `voice.sendText(...)`
- reactive transcript, interim transcript, status, audio level, metrics, connection, and error state
- server-side `withVoice(Agent)` with Workers AI STT, TTS, and LLM tools
- example-local `/sfu/*` routes for Cloudflare Realtime SFU integration

## WebRTC/SFU mode

The default WebSocket mode only needs the Workers AI binding. The WebRTC/SFU mode also needs Cloudflare Realtime credentials configured as Worker environment variables:

```txt
CLOUDFLARE_REALTIME_SFU_APP_ID
CLOUDFLARE_REALTIME_SFU_API_TOKEN
```

Without those credentials, the app disables the WebRTC/SFU option. The default WebSocket mode remains available.

## Deploy

```bash
npm run build
npx wrangler deploy
```
