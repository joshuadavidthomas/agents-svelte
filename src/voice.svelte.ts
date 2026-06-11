import { onDestroy, onMount } from "svelte";
import { createSubscriber } from "svelte/reactivity";
import {
  VoiceClient,
  type VoiceClientEvent,
  type VoiceClientOptions,
  type VoiceStatus,
  type VoiceAudioFormat,
  type TranscriptMessage,
  type VoicePipelineMetrics,
  type VoiceTransport,
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
  VoiceClientEventMap,
} from "@cloudflare/voice/client";

function subscribeToVoiceEvent<K extends VoiceClientEvent>(
  client: VoiceClient,
  event: K,
): () => void {
  return createSubscriber((update) => {
    const listener = () => update();
    client.addEventListener(event, listener);
    return () => {
      client.removeEventListener(event, listener);
    };
  });
}

export interface VoiceAgentOptions extends VoiceClientOptions {
  /** Whether the client should connect automatically. @default true */
  enabled?: boolean;
}

export class VoiceAgent {
  readonly #clientOptions: VoiceClientOptions;
  #pendingOutputDeviceId: string | undefined;
  #client: VoiceClient | null = null;
  #connectStarted = false;
  #enabled = true;

  #status = $state<VoiceStatus>("idle");
  #transcript = $state<TranscriptMessage[]>([]);
  #interimTranscript = $state<string | null>(null);
  #metrics = $state<VoicePipelineMetrics | null>(null);
  #audioLevel = $state(0);
  #isMuted = $state(false);
  #connected = $state(false);
  #error = $state<string | null>(null);
  #outputDeviceError = $state<string | null>(null);
  #lastCustomMessage = $state<unknown>(null);

  constructor(options: VoiceAgentOptions) {
    const { enabled = true, ...clientOptions } = options;
    this.#enabled = enabled;
    this.#clientOptions = clientOptions;
    this.#pendingOutputDeviceId = clientOptions.outputDeviceId;
  }

  connect(): void {
    if (!this.#enabled || this.#connectStarted) return;
    this.#connectStarted = true;
    try {
      this.#createClient().connect();
    } catch (error) {
      this.#disposeClient();
      throw error;
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    if (enabled) {
      this.connect();
      return;
    }
    this.#disposeClient();
  }

  get status(): VoiceStatus {
    return this.#status;
  }
  get transcript(): TranscriptMessage[] {
    return this.#transcript;
  }
  get interimTranscript(): string | null {
    return this.#interimTranscript;
  }
  get metrics(): VoicePipelineMetrics | null {
    return this.#metrics;
  }
  get audioLevel(): number {
    return this.#audioLevel;
  }
  get isMuted(): boolean {
    return this.#isMuted;
  }
  get connected(): boolean {
    return this.#connected;
  }
  get error(): string | null {
    return this.#error;
  }
  get outputDeviceError(): string | null {
    return this.#outputDeviceError;
  }
  get audioFormat(): VoiceAudioFormat | null {
    return this.#client?.audioFormat ?? null;
  }
  get serverProtocolVersion(): number | null {
    return this.#client?.serverProtocolVersion ?? null;
  }
  get lastCustomMessage(): unknown {
    return this.#lastCustomMessage;
  }

  startCall(): Promise<void> {
    return this.#client?.startCall() ?? Promise.resolve();
  }
  endCall(): void {
    this.#client?.endCall();
  }
  toggleMute(): void {
    this.#client?.toggleMute();
  }
  sendText(text: string): void {
    this.#client?.sendText(text);
  }
  sendJSON(data: Record<string, unknown>): void {
    this.#client?.sendJSON(data);
  }
  setOutputDevice(deviceId?: string): Promise<void> {
    this.#pendingOutputDeviceId = deviceId;
    this.#clientOptions.outputDeviceId = deviceId;
    return this.#client?.setOutputDevice(deviceId) ?? Promise.resolve();
  }

  close(): void {
    this.#disposeClient();
  }

  #createClient(): VoiceClient {
    if (this.#client) {
      return this.#client;
    }

    const client = new VoiceClient({
      ...this.#clientOptions,
      outputDeviceId: this.#pendingOutputDeviceId,
    });
    client.addEventListener("statuschange", this.#syncStatus);
    client.addEventListener("transcriptchange", this.#syncTranscript);
    client.addEventListener("interimtranscript", this.#syncInterimTranscript);
    client.addEventListener("metricschange", this.#syncMetrics);
    client.addEventListener("audiolevelchange", this.#syncAudioLevel);
    client.addEventListener("mutechange", this.#syncMute);
    client.addEventListener("connectionchange", this.#syncConnection);
    client.addEventListener("error", this.#syncError);
    client.addEventListener("outputdeviceerror", this.#syncOutputDeviceError);
    client.addEventListener("custommessage", this.#syncCustomMessage);
    this.#client = client;
    this.#syncAll();
    return client;
  }

  #disposeClient(): void {
    const client = this.#client;
    this.#connectStarted = false;
    this.#client = null;
    if (client) {
      client.removeEventListener("statuschange", this.#syncStatus);
      client.removeEventListener("transcriptchange", this.#syncTranscript);
      client.removeEventListener("interimtranscript", this.#syncInterimTranscript);
      client.removeEventListener("metricschange", this.#syncMetrics);
      client.removeEventListener("audiolevelchange", this.#syncAudioLevel);
      client.removeEventListener("mutechange", this.#syncMute);
      client.removeEventListener("connectionchange", this.#syncConnection);
      client.removeEventListener("error", this.#syncError);
      client.removeEventListener("outputdeviceerror", this.#syncOutputDeviceError);
      client.removeEventListener("custommessage", this.#syncCustomMessage);
      client.disconnect();
    }
    this.#resetState();
  }

  #syncAll(): void {
    this.#syncStatus();
    this.#syncTranscript();
    this.#syncInterimTranscript();
    this.#syncMetrics();
    this.#syncAudioLevel();
    this.#syncMute();
    this.#syncConnection();
    this.#syncError();
    this.#syncOutputDeviceError();
    this.#syncCustomMessage();
  }

  #resetState(): void {
    this.#status = "idle";
    this.#transcript = [];
    this.#interimTranscript = null;
    this.#metrics = null;
    this.#audioLevel = 0;
    this.#isMuted = false;
    this.#connected = false;
    this.#error = null;
    this.#outputDeviceError = null;
    this.#lastCustomMessage = null;
  }

  #syncStatus = (): void => {
    this.#status = this.#client?.status ?? "idle";
  };
  #syncTranscript = (): void => {
    this.#transcript = this.#client?.transcript ?? [];
  };
  #syncInterimTranscript = (): void => {
    this.#interimTranscript = this.#client?.interimTranscript ?? null;
  };
  #syncMetrics = (): void => {
    this.#metrics = this.#client?.metrics ?? null;
  };
  #syncAudioLevel = (): void => {
    this.#audioLevel = this.#client?.audioLevel ?? 0;
  };
  #syncMute = (): void => {
    this.#isMuted = this.#client?.isMuted ?? false;
  };
  #syncConnection = (): void => {
    this.#connected = this.#client?.connected ?? false;
  };
  #syncError = (): void => {
    this.#error = this.#client?.error ?? null;
  };
  #syncOutputDeviceError = (): void => {
    this.#outputDeviceError = this.#client?.outputDeviceError ?? null;
  };
  #syncCustomMessage = (): void => {
    this.#lastCustomMessage = this.#client?.lastCustomMessage ?? null;
  };
}

export function createVoiceAgent(options: VoiceAgentOptions): VoiceAgent {
  const v = new VoiceAgent(options);
  $effect(() => {
    v.setEnabled(options.enabled ?? true);
  });
  $effect(() => {
    void v.setOutputDevice(options.outputDeviceId);
  });
  onMount(() => v.connect());
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
  #connectStarted = false;

  constructor(options: VoiceInputOptions) {
    this.#client = new VoiceClient({
      agent: options.agent,
      name: options.name,
      host: options.host,
      transport: options.transport,
      silenceThreshold: options.silenceThreshold,
      silenceDurationMs: options.silenceDurationMs,
    });
    this.#statusChanged = subscribeToVoiceEvent(this.#client, "statuschange");
    this.#transcriptChanged = subscribeToVoiceEvent(this.#client, "transcriptchange");
    this.#interimTranscriptChanged = subscribeToVoiceEvent(this.#client, "interimtranscript");
    this.#audioLevelChanged = subscribeToVoiceEvent(this.#client, "audiolevelchange");
    this.#muteChanged = subscribeToVoiceEvent(this.#client, "mutechange");
    this.#errorChanged = subscribeToVoiceEvent(this.#client, "error");
  }

  connect(): void {
    if (this.#connectStarted) return;
    this.#connectStarted = true;
    this.#client.connect();
  }

  get transcript(): string {
    this.#transcriptChanged();
    const userMessages = this.#client.transcript.filter((m) => m.role === "user");
    const boundary = this.#clearedThroughUserMessage;
    const boundaryIndex = boundary
      ? userMessages.findIndex(
          (m) => m.text === boundary.text && m.timestamp === boundary.timestamp,
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
    const userMessages = this.#client.transcript.filter((m) => m.role === "user");
    const last = userMessages.at(-1);
    this.#clearedThroughUserMessage = last ? { text: last.text, timestamp: last.timestamp } : null;
  }

  close(): void {
    this.#connectStarted = false;
    this.#client.disconnect();
  }
}

export function createVoiceInput(options: VoiceInputOptions): VoiceInput {
  const v = new VoiceInput(options);
  onMount(() => v.connect());
  onDestroy(() => v.close());
  return v;
}
