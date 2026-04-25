import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageType } from "agents/types";

const { MockPartySocket, resetSockets } = vi.hoisted(() => {
  class MockPartySocket extends EventTarget {
    static instances: MockPartySocket[] = [];

    readonly options: Record<string, unknown>;
    readonly sent: string[] = [];
    readonly send = vi.fn((payload: string) => {
      this.sent.push(payload);
    });
    readonly close = vi.fn();
    readyState = 1;
    _pkurl: string;

    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      const basePath = options.basePath as string | undefined;
      const party = options.party as string | undefined;
      const room = (options.room as string | undefined) ?? "default";
      const host = (options.host as string | undefined) ?? "localhost:8787";
      this._pkurl = basePath
        ? `ws://${host}/${basePath}`
        : `ws://${host}/${String(options.prefix ?? "agents")}/${party}/${room}`;
      MockPartySocket.instances.push(this);
    }
  }

  return {
    MockPartySocket,
    resetSockets: () => {
      MockPartySocket.instances.length = 0;
    }
  };
});

vi.mock("partysocket", () => ({
  default: MockPartySocket,
  PartySocket: MockPartySocket
}));

import { Agent, type CreateAgentOptions } from "../agent.svelte.ts";

const cleanups: Array<() => void> = [];

function makeAgent<State = unknown>(
  options: CreateAgentOptions
): Agent<unknown, State> {
  const agent = new Agent<unknown, State>(options);
  cleanups.push(() => agent.close());
  return agent;
}

function latestSocket(): InstanceType<typeof MockPartySocket> {
  const socket = MockPartySocket.instances.at(-1);
  if (!socket) {
    throw new Error("Expected MockPartySocket instance");
  }
  return socket;
}

function dispatchMessage(socket: EventTarget, data: unknown) {
  socket.dispatchEvent(
    new MessageEvent("message", {
      data: typeof data === "string" ? data : JSON.stringify(data)
    })
  );
}

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()?.();
    } catch {
      // ignore
    }
  }
  resetSockets();
});

describe("createAgent — supplemental mocked lifecycle cases", () => {
  // These are intentionally the cases that are difficult to force through the
  // current real-worker harness: synthetic reconnect identity changes on the
  // same socket and abrupt local connection teardown during pending RPC work.

  it("records lastIdentityChange when identity changes after reconnect", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws"
    });
    const socket = latestSocket();

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "first-room",
      agent: "test-state-agent"
    });

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "second-room",
      agent: "other-agent"
    });

    expect(agent.lastIdentityChange).toEqual({
      oldIdentity: {
        name: "first-room",
        agent: "test-state-agent",
        identified: true
      },
      newIdentity: {
        name: "second-room",
        agent: "other-agent",
        identified: true
      },
      seq: 1
    });
    expect(agent.identity).toEqual({
      name: "second-room",
      agent: "other-agent",
      identified: true
    });
  });

  it("builds the HTTP URL without reading PartySocket private fields", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      name: "session-1",
      host: "example.com",
      path: "rpc"
    });
    const socket = latestSocket();
    delete (socket as { _pkurl?: string })._pkurl;

    expect(agent.getHttpUrl()).toBe(
      "https://example.com/agents/test-state-agent/session-1/rpc"
    );
  });

  it("builds basePath HTTP URLs without reading PartySocket private fields", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws",
      basePath: "custom-state/session-1"
    });
    const socket = latestSocket();
    delete (socket as { _pkurl?: string })._pkurl;

    expect(agent.getHttpUrl()).toBe(
      "http://localhost:8787/custom-state/session-1"
    );
  });

  it("marks identity un-identified on close", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws"
    });
    const socket = latestSocket();

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "room-1",
      agent: "test-state-agent"
    });
    socket.dispatchEvent(new CloseEvent("close"));

    expect(agent.identity.identified).toBe(false);
    expect(agent.connected).toBe(false);
  });

  it("rejects pending RPCs when the connection closes", async () => {
    const agent = makeAgent({
      agent: "TestCallableAgent",
      host: "localhost:8787",
      protocol: "ws"
    });
    const socket = latestSocket();

    const pending = agent.call("add", [1, 2]);
    socket.dispatchEvent(new CloseEvent("close"));

    await expect(pending).rejects.toThrow("Connection closed");
  });
});
