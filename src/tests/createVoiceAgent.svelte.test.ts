import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import type { VoiceTransport } from "../voice.svelte.ts";

let transportInstance: (VoiceTransport & { connected: boolean }) | null = null;
let transportSendJSON: ReturnType<typeof vi.fn<(data: Record<string, unknown>) => void>>;
let transportSendBinary: ReturnType<typeof vi.fn<(data: ArrayBuffer) => void>>;
let transportConnect: ReturnType<typeof vi.fn<() => void>>;
let transportDisconnect: ReturnType<typeof vi.fn<() => void>>;

function createFakeTransport(): VoiceTransport & { connected: boolean } {
  const transport: VoiceTransport & { connected: boolean } = {
    connected: false,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    connect: () => transportConnect(),
    disconnect: () => transportDisconnect(),
    sendJSON: (data) => transportSendJSON(data),
    sendBinary: (data) => transportSendBinary(data),
  };
  transportConnect.mockImplementation(() => {
    transportInstance = transport;
    transport.connected = true;
    queueMicrotask(() => transport.onopen?.());
  });
  transportDisconnect.mockImplementation(() => {
    transport.connected = false;
    transport.onclose?.();
  });
  return transport;
}

const { VoiceClient } = await import("@cloudflare/voice/client");
const { VoiceAgent } = await import("../voice.svelte.ts");
type VoiceAgentInstance = InstanceType<typeof VoiceAgent>;

const cleanups: Array<() => void> = [];

function makeVoice(
  overrides: Partial<ConstructorParameters<typeof VoiceAgent>[0]> = {},
): VoiceAgentInstance {
  const v = new VoiceAgent({
    agent: "voice-agent",
    transport: createFakeTransport(),
    ...overrides,
  });
  v.connect();
  cleanups.push(() => v.close());
  return v;
}

function fireJSON(msg: Record<string, unknown>) {
  transportInstance?.onmessage?.(JSON.stringify(msg));
}

beforeEach(() => {
  transportSendJSON = vi.fn();
  transportSendBinary = vi.fn();
  transportConnect = vi.fn();
  transportDisconnect = vi.fn();
  transportInstance = null;
});

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()?.();
    } catch {
      // ignore
    }
  }
  vi.restoreAllMocks();
});

describe("VoiceAgent", () => {
  it("starts connected with initial VoiceClient state", async () => {
    const v = makeVoice();

    await vi.waitFor(() => expect(v.connected).toBe(true));

    expect(v.status).toBe("idle");
    expect(v.transcript).toEqual([]);
    expect(v.interimTranscript).toBeNull();
    expect(v.metrics).toBeNull();
    expect(v.error).toBeNull();
    expect(v.isMuted).toBe(false);
  });

  it("does not create or connect a VoiceClient when disabled", async () => {
    const v = makeVoice({ enabled: false });

    expect(v.connected).toBe(false);
    expect(transportInstance).toBeNull();
    expect(transportConnect).not.toHaveBeenCalled();
    await expect(v.startCall()).resolves.toBeUndefined();

    v.setEnabled(true);

    expect(transportInstance).not.toBeNull();
    expect(transportConnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when disabled after connecting", async () => {
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));

    v.setEnabled(false);

    expect(transportDisconnect).toHaveBeenCalledTimes(1);
    expect(v.connected).toBe(false);
  });

  it("can connect again after close", async () => {
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));

    v.close();
    expect(transportDisconnect).toHaveBeenCalledTimes(1);

    v.connect();
    expect(transportConnect).toHaveBeenCalledTimes(2);
  });

  it("can retry after a lazy connect failure", () => {
    const transport = createFakeTransport();
    const error = new Error("connect failed");
    transportConnect.mockImplementationOnce(() => {
      throw error;
    });
    const v = new VoiceAgent({ agent: "voice-agent", transport });
    cleanups.push(() => v.close());

    expect(() => v.connect()).toThrow(error);
    expect(transportConnect).toHaveBeenCalledTimes(1);

    v.connect();

    expect(transportConnect).toHaveBeenCalledTimes(2);
  });

  it("reflects VoiceClient state through reactive getters", async () => {
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));

    fireJSON({ type: "status", status: "listening" });
    fireJSON({ type: "transcript", role: "user", text: "Hello agent" });
    fireJSON({
      type: "metrics",
      llm_ms: 800,
      tts_ms: 200,
      first_audio_ms: 1470,
      total_ms: 1600,
    });
    fireJSON({ type: "error", message: "Pipeline failed" });
    flushSync();

    await vi.waitFor(() => expect(v.status).toBe("listening"));
    expect(v.transcript.at(-1)).toMatchObject({
      role: "user",
      text: "Hello agent",
    });
    expect(v.metrics).toMatchObject({ llm_ms: 800, total_ms: 1600 });
    expect(v.error).toBe("Pipeline failed");
  });

  it("does not invalidate status reads for unrelated voice events", async () => {
    const v = makeVoice();
    let runs = 0;

    const dispose = $effect.root(() => {
      $effect(() => {
        void v.status;
        runs += 1;
      });
    });
    cleanups.push(dispose);
    flushSync();
    expect(runs).toBe(1);

    await vi.waitFor(() => expect(v.connected).toBe(true));
    expect(runs).toBe(1);

    v.toggleMute();
    fireJSON({
      type: "metrics",
      llm_ms: 800,
      tts_ms: 200,
      first_audio_ms: 1470,
      total_ms: 1600,
    });
    flushSync();
    expect(runs).toBe(1);

    fireJSON({ type: "status", status: "listening" });
    flushSync();
    expect(runs).toBe(2);
  });

  it("exposes the last app-level custom message", async () => {
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));
    expect(v.lastCustomMessage).toBeNull();

    fireJSON({ type: "app_event", payload: { ok: true } });
    flushSync();

    await vi.waitFor(() =>
      expect(v.lastCustomMessage).toEqual({
        type: "app_event",
        payload: { ok: true },
      }),
    );
  });

  it("proxies output device changes to VoiceClient", async () => {
    const setOutputDevice = vi
      .spyOn(VoiceClient.prototype, "setOutputDevice")
      .mockResolvedValue(undefined);
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));

    await v.setOutputDevice("speaker-1");

    expect(setOutputDevice).toHaveBeenCalledWith("speaker-1");
  });

  it("closes the underlying connection", async () => {
    const v = makeVoice();
    await vi.waitFor(() => expect(v.connected).toBe(true));

    v.close();

    expect(transportDisconnect).toHaveBeenCalled();
  });
});
