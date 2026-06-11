# Voice agent

Svelte voice chat app backed by a Cloudflare Agent Durable Object.

The agent streams microphone audio to Workers AI STT, responds with generated speech, keeps conversation history, and can call tools for time, reminders, and weather.

TTS uses Workers AI by default. If `ELEVENLABS_API_KEY` is set, the server uses ElevenLabs streaming TTS instead.

The default WebSocket path needs only Workers AI. The optional WebRTC/SFU path requires Cloudflare Realtime SFU credentials.

The app defaults to Nova 3 STT, GLM 4.7 Flash for the LLM, and Workers AI TTS. The UI also lets you switch STT to Flux and the LLM to GPT-OSS 20B or Kimi K2.6.

## What it demonstrates

- `new VoiceAgent({ agent: "MyVoiceAgent" })` for explicit controller lifetime when rebuilding voice options
- Switching the voice controller between WebSocket and WebRTC/SFU microphone input
- Switching STT between Nova 3 and Flux, with Nova 3 as the default
- Selecting the browser audio output device with `voice.setOutputDevice(...)`
- `voice.startCall()`, `voice.endCall()`, and `voice.toggleMute()`
- Sending typed text messages with `voice.sendText(...)`
- Reactive transcript, interim transcript, status, audio level, metrics, connection, error, and output-device error state
- Server-side `withVoice(Agent)` with Workers AI STT, Workers AI or ElevenLabs TTS, and LLM tools
- Example-local `/sfu/*` routes for Cloudflare Realtime SFU integration

## Cloudflare setup

The Worker uses Workers AI for speech-to-text, text generation, and default text-to-speech. If you are already logged in, you can skip the login command below.

For optional ElevenLabs TTS, copy `.dev.vars.example` to `.dev.vars` and set `ELEVENLABS_API_KEY`:

```bash
cp .dev.vars.example .dev.vars
```

You can also set `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID`. For deployed apps, store the API key with `wrangler secret put ELEVENLABS_API_KEY`.

For WebRTC/SFU mode, configure these Worker environment variables:

```txt
CLOUDFLARE_REALTIME_SFU_APP_ID
CLOUDFLARE_REALTIME_SFU_API_TOKEN
```

Without those credentials, the app disables the WebRTC/SFU option. The default WebSocket mode remains available.

## Run locally

Clone this repository, then run from this example directory:

```bash
pnpm install
pnpm exec wrangler login
pnpm run dev
```

Open the local Vite URL and click **Start Call**. The browser will ask for microphone permission.

Localhost is allowed for microphone testing. For deployed apps, serve over HTTPS and test microphone permissions and audio playback in your target browsers.

This example uses `new VoiceAgent(...)` because it rebuilds the controller when transport, STT, or LLM options change. Most components can use `createVoiceAgent(...)`.

## Try it

Ask:

```txt
What time is it?
Remind me in 10 seconds to stretch.
What's the weather in Austin?
```

The weather tool returns demo data unless you connect it to a real weather provider.

## Build

```bash
pnpm run build
```

## Deploy

```bash
pnpm run build
pnpm exec wrangler deploy
```
