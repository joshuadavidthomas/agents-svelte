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
    transport.connected = true;
    queueMicrotask(() => transport.onopen?.());
  });
  transportDisconnect.mockImplementation(() => {
    transport.connected = false;
    transport.onclose?.();
  });
  transportInstance = transport;
  return transport;
}

const { VoiceInput } = await import("../voice.svelte.ts");
type VoiceInputInstance = InstanceType<typeof VoiceInput>;

const cleanups: Array<() => void> = [];

function makeInput(
  overrides: Partial<ConstructorParameters<typeof VoiceInput>[0]> = {},
): VoiceInputInstance {
  const v = new VoiceInput({
    agent: "voice-input-agent",
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

describe("VoiceInput", () => {
  it("starts with dictation-oriented initial state", async () => {
    const v = makeInput();

    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    expect(v.transcript).toBe("");
    expect(v.interimTranscript).toBeNull();
    expect(v.isListening).toBe(false);
    expect(v.audioLevel).toBe(0);
    expect(v.isMuted).toBe(false);
    expect(v.error).toBeNull();
  });

  it("can connect again after close", () => {
    const v = makeInput();

    v.close();
    expect(transportDisconnect).toHaveBeenCalledTimes(1);

    v.connect();
    expect(transportConnect).toHaveBeenCalledTimes(2);
  });

  it("accumulates user transcripts and ignores assistant transcripts", async () => {
    const v = makeInput();
    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "transcript", role: "user", text: "hello" });
    fireJSON({ type: "transcript", role: "assistant", text: "hi there" });
    fireJSON({ type: "transcript", role: "user", text: "world" });
    flushSync();

    await vi.waitFor(() => expect(v.transcript).toBe("hello world"));
  });

  it("clear hides existing user transcripts and keeps accumulating future ones", async () => {
    const v = makeInput();
    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "transcript", role: "user", text: "before" });
    flushSync();
    await vi.waitFor(() => expect(v.transcript).toBe("before"));

    v.clear();
    flushSync();
    expect(v.transcript).toBe("");

    fireJSON({ type: "transcript", role: "user", text: "after" });
    flushSync();
    await vi.waitFor(() => expect(v.transcript).toBe("after"));
  });

  it("keeps new transcript text after clear when old messages are compacted", async () => {
    const v = makeInput();
    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "transcript", role: "user", text: "before" });
    flushSync();
    await vi.waitFor(() => expect(v.transcript).toBe("before"));

    v.clear();
    flushSync();
    expect(v.transcript).toBe("");

    for (let i = 0; i < 205; i += 1) {
      fireJSON({ type: "transcript", role: "user", text: `after-${i}` });
    }
    flushSync();

    await vi.waitFor(() => {
      const parts = v.transcript.split(" ");
      expect(parts).toHaveLength(200);
      expect(parts[0]).toBe("after-5");
      expect(parts.at(-1)).toBe("after-204");
    });
  });

  it("maps voice status to isListening", async () => {
    const v = makeInput();
    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "status", status: "listening" });
    flushSync();
    await vi.waitFor(() => expect(v.isListening).toBe(true));

    fireJSON({ type: "status", status: "thinking" });
    flushSync();
    await vi.waitFor(() => expect(v.isListening).toBe(true));

    fireJSON({ type: "status", status: "idle" });
    flushSync();
    await vi.waitFor(() => expect(v.isListening).toBe(false));
  });

  it("does not invalidate transcript reads for unrelated voice events", async () => {
    const v = makeInput();
    let runs = 0;

    const dispose = $effect.root(() => {
      $effect(() => {
        void v.transcript;
        runs += 1;
      });
    });
    cleanups.push(dispose);
    flushSync();
    expect(runs).toBe(1);

    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "status", status: "listening" });
    v.toggleMute();
    flushSync();
    expect(runs).toBe(1);

    fireJSON({ type: "transcript", role: "user", text: "hello" });
    flushSync();
    expect(runs).toBe(2);

    v.clear();
    flushSync();
    expect(runs).toBe(3);
  });

  it("exposes interim transcript, mute, error, and cleanup state", async () => {
    const v = makeInput();
    await vi.waitFor(() => expect(transportInstance).not.toBeNull());

    fireJSON({ type: "transcript_interim", text: "hel" });
    fireJSON({ type: "error", message: "STT failed" });
    v.toggleMute();
    flushSync();

    await vi.waitFor(() => expect(v.interimTranscript).toBe("hel"));
    expect(v.error).toBe("STT failed");
    expect(v.isMuted).toBe(true);

    v.close();
    expect(transportDisconnect).toHaveBeenCalled();
  });
});
