import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte/pure";
import { MessageType } from "@cloudflare/ai-chat/types";
import { Agent } from "../agent.svelte.ts";
import { AgentChat } from "../chat.svelte.ts";
import type { VoiceTransport } from "../voice.svelte.ts";
import FactoryLifecycleHarness from "./FactoryLifecycleHarness.svelte";
import DirectAgentChatLifecycleHarness from "./DirectAgentChatLifecycleHarness.svelte";
import AsyncQueryHarness from "./AsyncQueryHarness.svelte";

const { MockPartySocket, resetSockets } = vi.hoisted(() => {
  class MockPartySocket extends EventTarget {
    static instances: MockPartySocket[] = [];

    readonly options: Record<string, unknown>;
    readonly sent: string[] = [];
    readonly send = vi.fn((payload: string) => {
      this.sent.push(payload);
    });
    readonly close = vi.fn(() => {
      this.dispatchEvent(new CloseEvent("close"));
    });

    constructor(options: Record<string, unknown> = {}) {
      super();
      this.options = options;
      MockPartySocket.instances.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
  }

  return {
    MockPartySocket,
    resetSockets: () => {
      MockPartySocket.instances.length = 0;
    },
  };
});

vi.mock("partysocket", () => ({
  default: MockPartySocket,
  PartySocket: MockPartySocket,
}));

function createFakeVoiceTransport() {
  const connect = vi.fn(() => {
    transport.connected = true;
    queueMicrotask(() => transport.onopen?.());
  });
  const disconnect = vi.fn(() => {
    transport.connected = false;
    transport.onclose?.();
  });
  const transport: VoiceTransport & {
    connected: boolean;
    connect: typeof connect;
    disconnect: typeof disconnect;
  } = {
    connected: false,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    connect,
    disconnect,
    sendJSON: vi.fn(),
    sendBinary: vi.fn(),
  };
  return transport;
}

afterEach(() => {
  cleanup();
  resetSockets();
});

describe("factory lifecycle", () => {
  it("connects once on mount and cleans up without teardown-order errors", async () => {
    const getInitialMessages = vi.fn(async () => []);
    const voiceTransport = createFakeVoiceTransport();
    const voiceInputTransport = createFakeVoiceTransport();

    render(FactoryLifecycleHarness, {
      getInitialMessages,
      voiceTransport,
      voiceInputTransport,
    });

    await vi.waitFor(() => {
      expect(getInitialMessages).toHaveBeenCalledTimes(1);
      expect(voiceTransport.connect).toHaveBeenCalledTimes(1);
      expect(voiceInputTransport.connect).toHaveBeenCalledTimes(1);
    });

    expect(MockPartySocket.instances).toHaveLength(1);
    expect(
      MockPartySocket.instances[0].sent.filter((payload) => {
        try {
          return JSON.parse(payload).type === MessageType.CF_AGENT_STREAM_RESUME_REQUEST;
        } catch {
          return false;
        }
      }),
    ).toHaveLength(1);

    expect(() => cleanup()).not.toThrow();
    expect(MockPartySocket.instances[0].close).toHaveBeenCalledTimes(1);
    expect(voiceTransport.disconnect).toHaveBeenCalledTimes(1);
    expect(voiceInputTransport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("closes an agent connection opened by createAgentChat", async () => {
    const getInitialMessages = vi.fn(async () => []);

    render(DirectAgentChatLifecycleHarness, { getInitialMessages });

    await vi.waitFor(() => {
      expect(getInitialMessages).toHaveBeenCalledTimes(1);
    });

    expect(MockPartySocket.instances).toHaveLength(1);

    cleanup();

    expect(MockPartySocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("does not close an agent connection it did not open", () => {
    const agent = new Agent({
      agent: "TestAgent",
      name: "preconnected-room",
      host: "localhost:8787",
      protocol: "ws",
    });
    agent.connect();
    const socket = MockPartySocket.instances[0];
    const chat = new AgentChat({ agent, getInitialMessages: null, resume: false });

    chat.connect();
    chat.close();

    expect(socket.close).not.toHaveBeenCalled();
    agent.close();
  });

  it("refreshes async query params when reactive inputs change", async () => {
    const query = vi.fn(async (token: string) => ({ token }));
    const screen = await render(AsyncQueryHarness, { token: "one", query });

    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });
    expect(MockPartySocket.instances[0].options.query).toEqual({ token: "one" });

    await screen.rerender({ token: "two", query });

    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(2);
    });
    expect(MockPartySocket.instances[0].close).toHaveBeenCalledTimes(1);
    expect(MockPartySocket.instances[1].options.query).toEqual({ token: "two" });
    expect(query).toHaveBeenCalledWith("one");
    expect(query).toHaveBeenCalledWith("two");
  });

  it("closes an owned agent connection when chat setup throws", () => {
    const agent = new Agent({
      agent: "TestAgent",
      name: "throwing-chat-room",
      host: "localhost:8787",
      protocol: "ws",
    });
    const chat = new AgentChat({
      agent,
      getInitialMessages: () => {
        throw new Error("sync load failed");
      },
      resume: false,
    });

    expect(() => chat.connect()).toThrow("sync load failed");
    expect(MockPartySocket.instances[0].close).toHaveBeenCalledTimes(1);
    expect(() => chat.close()).not.toThrow();
  });
});
