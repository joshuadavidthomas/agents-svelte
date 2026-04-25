import type {
  VoiceAgent,
  VoiceInput,
  VoiceInputOptions,
  VoiceTransport
} from "../voice.svelte.ts";

declare const transport: VoiceTransport;
const voiceInputOptions: VoiceInputOptions = {
  agent: "voice-input-agent",
  transport
};
void voiceInputOptions;

declare const voice: VoiceAgent;
declare const input: VoiceInput;

// @ts-expect-error underlying VoiceClient is intentionally not public
voice.client;

// @ts-expect-error underlying VoiceClient is intentionally not public
input.client;
