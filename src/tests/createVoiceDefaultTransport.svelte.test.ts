import { afterEach, describe, expect, it, vi } from "vitest";

const { VoiceAgent } = await import("../voice.svelte.ts");

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  binaryType: BinaryType = "blob";
  readyState = MockWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(payload: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("Expected MockWebSocket instance");
  }
  return socket;
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockWebSocket.instances.length = 0;
});

describe("VoiceAgent default transport", () => {
  it("connects through the default WebSocket voice transport", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

    const voice = new VoiceAgent({
      agent: "VoiceAgent",
      name: "session-1",
      host: "example.com",
    });
    voice.connect();

    try {
      await vi.waitFor(() => expect(voice.connected).toBe(true));

      const socket = latestSocket();
      const hello = socket.sent.find((payload): payload is string => typeof payload === "string");
      expect(hello ? JSON.parse(hello) : null).toMatchObject({
        type: "hello",
        protocol_version: expect.any(Number),
      });

      voice.close();
      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    } finally {
      voice.close();
    }
  });
});
