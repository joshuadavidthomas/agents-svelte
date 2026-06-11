import type {
  VoiceAgent,
  VoiceAudioFormat,
  VoiceInput,
  VoiceInputOptions,
  VoiceTransport,
} from "../voice.svelte.ts";

declare const transport: VoiceTransport;
const voiceInputOptions: VoiceInputOptions = {
  agent: "voice-input-agent",
  transport,
};
void voiceInputOptions;

declare const voice: VoiceAgent;
declare const input: VoiceInput;

const outputDeviceError: string | null = voice.outputDeviceError;
const audioFormat: VoiceAudioFormat | null = voice.audioFormat;
const serverProtocolVersion: number | null = voice.serverProtocolVersion;
const setOutputDeviceResult: Promise<void> = voice.setOutputDevice("speaker");
void outputDeviceError;
void audioFormat;
void serverProtocolVersion;
void setOutputDeviceResult;

// @ts-expect-error underlying VoiceClient is intentionally not public
void voice.client;

// @ts-expect-error underlying VoiceClient is intentionally not public
void input.client;
