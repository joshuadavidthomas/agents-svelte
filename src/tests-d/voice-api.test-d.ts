import type { VoiceAgent, VoiceInput, VoiceInputOptions, VoiceTransport } from "../voice.svelte.ts";

declare const transport: VoiceTransport;
const voiceInputOptions: VoiceInputOptions = {
  agent: "voice-input-agent",
  transport,
};
void voiceInputOptions;

declare const voice: VoiceAgent;
declare const input: VoiceInput;

const outputDeviceError: string | null = voice.outputDeviceError;
void outputDeviceError;
void voice.setOutputDevice("speaker-id");

// @ts-expect-error underlying VoiceClient is intentionally not public
void voice.client;

// @ts-expect-error underlying VoiceClient is intentionally not public
void input.client;
