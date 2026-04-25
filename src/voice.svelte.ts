import { onDestroy } from "svelte";
import { createSubscriber } from "svelte/reactivity";
import {
  VoiceClient,
  type VoiceClientEvent,
  type VoiceClientOptions,
  type VoiceStatus,
  type TranscriptMessage,
  type VoicePipelineMetrics,
  type VoiceTransport
} from "@cloudflare/voice/client";

export { WebSocketVoiceTransport } from "@cloudflare/voice/client";
export type {
  VoiceStatus,
  VoiceRole,
  VoiceAudioFormat,
  VoiceAudioInput,
  VoiceTransport,
  TranscriptMessage,
  VoicePipelineMetrics,
  VoiceClientOptions,
  VoiceClientEvent,
  VoiceClientEventMap
} from "@cloudflare/voice/client";

function subscribeToVoiceEvent<K extends VoiceClientEvent>(
  client: VoiceClient,
  event: K
): () => void {
  return createSubscriber((update) => {
    const listener = () => update();
    client.addEventListener(event, listener);
    return () => {
      client.removeEventListener(event, listener);
    };
  });
}

export class VoiceAgent {
  readonly #client: VoiceClient;
  readonly #statusChanged: () => void;
  readonly #transcriptChanged: () => void;
  readonly #interimTranscriptChanged: () => void;
  readonly #metricsChanged: () => void;
  readonly #audioLevelChanged: () => void;
  readonly #muteChanged: () => void;
  readonly #connectionChanged: () => void;
  readonly #errorChanged: () => void;
  readonly #customMessageChanged: () => void;

  constructor(options: VoiceClientOptions) {
    this.#client = new VoiceClient(options);
    this.#statusChanged = subscribeToVoiceEvent(this.#client, "statuschange");
    this.#transcriptChanged = subscribeToVoiceEvent(
      this.#client,
      "transcriptchange"
    );
    this.#interimTranscriptChanged = subscribeToVoiceEvent(
      this.#client,
      "interimtranscript"
    );
    this.#metricsChanged = subscribeToVoiceEvent(this.#client, "metricschange");
    this.#audioLevelChanged = subscribeToVoiceEvent(
      this.#client,
      "audiolevelchange"
    );
    this.#muteChanged = subscribeToVoiceEvent(this.#client, "mutechange");
    this.#connectionChanged = subscribeToVoiceEvent(
      this.#client,
      "connectionchange"
    );
    this.#errorChanged = subscribeToVoiceEvent(this.#client, "error");
    this.#customMessageChanged = subscribeToVoiceEvent(
      this.#client,
      "custommessage"
    );
    this.#client.connect();
  }

  get status(): VoiceStatus {
    this.#statusChanged();
    return this.#client.status;
  }
  get transcript(): TranscriptMessage[] {
    this.#transcriptChanged();
    return this.#client.transcript;
  }
  get interimTranscript(): string | null {
    this.#interimTranscriptChanged();
    return this.#client.interimTranscript;
  }
  get metrics(): VoicePipelineMetrics | null {
    this.#metricsChanged();
    return this.#client.metrics;
  }
  get audioLevel(): number {
    this.#audioLevelChanged();
    return this.#client.audioLevel;
  }
  get isMuted(): boolean {
    this.#muteChanged();
    return this.#client.isMuted;
  }
  get connected(): boolean {
    this.#connectionChanged();
    return this.#client.connected;
  }
  get error(): string | null {
    this.#errorChanged();
    return this.#client.error;
  }
  get lastCustomMessage(): unknown {
    this.#customMessageChanged();
    return this.#client.lastCustomMessage;
  }

  startCall(): Promise<void> {
    return this.#client.startCall();
  }
  endCall(): void {
    this.#client.endCall();
  }
  toggleMute(): void {
    this.#client.toggleMute();
  }
  sendText(text: string): void {
    this.#client.sendText(text);
  }
  sendJSON(data: Record<string, unknown>): void {
    this.#client.sendJSON(data);
  }

  close(): void {
    this.#client.disconnect();
  }
}

export function createVoiceAgent(options: VoiceClientOptions): VoiceAgent {
  const v = new VoiceAgent(options);
  onDestroy(() => v.close());
  return v;
}

export interface VoiceInputOptions {
  agent: string;
  name?: string;
  host?: string;
  transport?: VoiceTransport;
  silenceThreshold?: number;
  silenceDurationMs?: number;
}

export class VoiceInput {
  readonly #client: VoiceClient;
  readonly #statusChanged: () => void;
  readonly #transcriptChanged: () => void;
  readonly #interimTranscriptChanged: () => void;
  readonly #audioLevelChanged: () => void;
  readonly #muteChanged: () => void;
  readonly #errorChanged: () => void;
  #clearedThroughUserMessage = $state<{
    text: string;
    timestamp: number;
  } | null>(null);

  constructor(options: VoiceInputOptions) {
    this.#client = new VoiceClient({
      agent: options.agent,
      name: options.name,
      host: options.host,
      transport: options.transport,
      silenceThreshold: options.silenceThreshold,
      silenceDurationMs: options.silenceDurationMs
    });
    this.#statusChanged = subscribeToVoiceEvent(this.#client, "statuschange");
    this.#transcriptChanged = subscribeToVoiceEvent(
      this.#client,
      "transcriptchange"
    );
    this.#interimTranscriptChanged = subscribeToVoiceEvent(
      this.#client,
      "interimtranscript"
    );
    this.#audioLevelChanged = subscribeToVoiceEvent(
      this.#client,
      "audiolevelchange"
    );
    this.#muteChanged = subscribeToVoiceEvent(this.#client, "mutechange");
    this.#errorChanged = subscribeToVoiceEvent(this.#client, "error");
    this.#client.connect();
  }

  get transcript(): string {
    this.#transcriptChanged();
    const userMessages = this.#client.transcript.filter(
      (m) => m.role === "user"
    );
    const boundary = this.#clearedThroughUserMessage;
    const boundaryIndex = boundary
      ? userMessages.findIndex(
          (m) => m.text === boundary.text && m.timestamp === boundary.timestamp
        )
      : -1;
    return userMessages
      .slice(boundaryIndex + 1)
      .map((m) => m.text)
      .join(" ");
  }
  get interimTranscript(): string | null {
    this.#interimTranscriptChanged();
    return this.#client.interimTranscript;
  }
  get isListening(): boolean {
    this.#statusChanged();
    const s = this.#client.status;
    return s === "listening" || s === "thinking";
  }
  get audioLevel(): number {
    this.#audioLevelChanged();
    return this.#client.audioLevel;
  }
  get isMuted(): boolean {
    this.#muteChanged();
    return this.#client.isMuted;
  }
  get error(): string | null {
    this.#errorChanged();
    return this.#client.error;
  }

  start(): Promise<void> {
    return this.#client.startCall();
  }
  stop(): void {
    this.#client.endCall();
  }
  toggleMute(): void {
    this.#client.toggleMute();
  }
  clear(): void {
    const userMessages = this.#client.transcript.filter(
      (m) => m.role === "user"
    );
    const last = userMessages.at(-1);
    this.#clearedThroughUserMessage = last
      ? { text: last.text, timestamp: last.timestamp }
      : null;
  }

  close(): void {
    this.#client.disconnect();
  }
}

export function createVoiceInput(options: VoiceInputOptions): VoiceInput {
  const v = new VoiceInput(options);
  onDestroy(() => v.close());
  return v;
}
