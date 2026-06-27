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
    },
  };
});

vi.mock("partysocket", () => ({
  default: MockPartySocket,
  PartySocket: MockPartySocket,
}));

vi.mock("agents/client", () => ({
  AgentClient: MockPartySocket,
  AgentConnectionError: class AgentConnectionError extends Error {
    code: number;
    reason: string;
    wasClean: boolean;

    constructor(event: CloseEvent) {
      const reason = event.reason || `WebSocket closed with code ${event.code}`;
      super(`Agent connection closed: ${reason}`);
      this.name = "AgentConnectionError";
      this.code = event.code;
      this.reason = event.reason;
      this.wasClean = event.wasClean;
    }
  },
  DEFAULT_CALL_TIMEOUT_MS: 30000,
  createStubProxy: (call: (method: string, args: unknown[]) => unknown) =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== "string" || method === "then" || method === "toJSON") return;
          return (...args: unknown[]) => call(method, args);
        },
      },
    ),
  isTerminalCloseEvent: (event: CloseEvent) =>
    event.code === 1008 || (event.code >= 4000 && event.code <= 4999),
}));

import { Agent, type CreateAgentOptions } from "../agent.svelte.ts";

const cleanups: Array<() => void> = [];

function makeAgent<State = unknown>(options: CreateAgentOptions): Agent<unknown, State> {
  const agent = new Agent<unknown, State>(options);
  agent.connect();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dispatchMessage(socket: EventTarget, data: unknown) {
  socket.dispatchEvent(
    new MessageEvent("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
    }),
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
      protocol: "ws",
    });
    const socket = latestSocket();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "first-room",
      agent: "test-state-agent",
    });

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "second-room",
      agent: "other-agent",
    });

    expect(agent.lastIdentityChange).toEqual({
      oldIdentity: {
        name: "first-room",
        agent: "test-state-agent",
        identified: true,
      },
      newIdentity: {
        name: "second-room",
        agent: "other-agent",
        identified: true,
      },
      seq: 1,
    });
    expect(agent.identity).toEqual({
      name: "second-room",
      agent: "other-agent",
      identified: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Identity changed on reconnect"));
    warn.mockRestore();
  });

  it("calls onIdentityChange instead of warning when provided", () => {
    const onIdentityChange = vi.fn();
    makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws",
      onIdentityChange,
    });
    const socket = latestSocket();
    expect(typeof socket.options.onIdentityChange).toBe("function");
    expect(socket.options.onIdentityChange).not.toBe(onIdentityChange);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "first-room",
      agent: "test-state-agent",
    });
    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "second-room",
      agent: "other-agent",
    });

    expect(onIdentityChange).toHaveBeenCalledWith(
      "first-room",
      "second-room",
      "test-state-agent",
      "other-agent",
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("builds the HTTP URL without reading PartySocket private fields", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      name: "session-1",
      host: "example.com",
      path: "rpc",
    });
    const socket = latestSocket();
    delete (socket as { _pkurl?: string })._pkurl;

    expect(agent.getHttpUrl()).toBe("https://example.com/agents/test-state-agent/session-1/rpc");
  });

  it("builds basePath HTTP URLs without reading PartySocket private fields", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws",
      basePath: "custom-state/session-1",
    });
    const socket = latestSocket();
    delete (socket as { _pkurl?: string })._pkurl;

    expect(agent.getHttpUrl()).toBe("http://localhost:8787/custom-state/session-1");
  });

  it("passes normalized hosts to PartySocket and HTTP URL generation", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "https://example.com/",
      name: "session-1",
    });
    const socket = latestSocket();

    expect(socket.options.host).toBe("example.com");
    expect(agent.getHttpUrl()).toBe("https://example.com/agents/test-state-agent/session-1");
  });

  it("uses ws for local hosts without requiring a port", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost",
      name: "session-1",
    });
    const socket = latestSocket();

    expect(socket.options.protocol).toBeUndefined();
    expect(agent.getHttpUrl()).toBe("http://localhost/agents/test-state-agent/session-1");
  });

  it("uses ws for private IPv4 hosts with numeric octet checks", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "172.16.0.2:8787",
      name: "session-1",
    });

    expect(agent.getHttpUrl()).toBe("http://172.16.0.2:8787/agents/test-state-agent/session-1");
  });

  it("marks identity un-identified on close", () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws",
    });
    const socket = latestSocket();

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "room-1",
      agent: "test-state-agent",
    });
    socket.dispatchEvent(new CloseEvent("close"));

    expect(agent.identity.identified).toBe(false);
    expect(agent.connected).toBe(false);
  });

  it("exposes a ready promise that resolves on identity and resets on close", async () => {
    const agent = makeAgent({
      agent: "TestStateAgent",
      host: "localhost:8787",
      protocol: "ws",
    });
    const socket = latestSocket();
    const firstReady = agent.ready;
    const firstResolved = vi.fn();
    firstReady.then(firstResolved);
    await Promise.resolve();
    expect(firstResolved).not.toHaveBeenCalled();

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "room-1",
      agent: "test-state-agent",
    });
    await expect(firstReady).resolves.toBeUndefined();
    expect(firstResolved).toHaveBeenCalled();

    socket.dispatchEvent(new CloseEvent("close"));
    const secondReady = agent.ready;
    expect(secondReady).not.toBe(firstReady);

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "room-1",
      agent: "test-state-agent",
    });
    await expect(secondReady).resolves.toBeUndefined();
  });

  it("rejects pending RPCs when the connection closes", async () => {
    const agent = makeAgent({
      agent: "TestCallableAgent",
      host: "localhost:8787",
      protocol: "ws",
    });
    const socket = latestSocket();

    const pending = agent.call("add", [1, 2]);
    socket.dispatchEvent(new CloseEvent("close"));

    await expect(pending).rejects.toThrow("Connection closed");
  });

  it("rejects RPC calls when their timeout expires", async () => {
    vi.useFakeTimers();
    try {
      const agent = makeAgent({
        agent: "TestCallableAgent",
        host: "localhost:8787",
        protocol: "ws",
      });
      const onError = vi.fn();

      const pending = agent.call("slow", [], {
        timeout: 25,
        stream: { onError },
      });

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).rejects.toThrow("RPC call to slow timed out after 25ms");
      expect(onError).toHaveBeenCalledWith("RPC call to slow timed out after 25ms");
      expect(latestSocket().sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the default non-streaming RPC timeout", async () => {
    vi.useFakeTimers();
    try {
      const agent = makeAgent({
        agent: "TestCallableAgent",
        host: "localhost:8787",
        protocol: "ws",
        defaultCallTimeout: 25,
      });

      const pending = agent.call("slow", []);

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).rejects.toThrow("RPC call to slow timed out after 25ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply the default timeout to streaming RPC calls", async () => {
    vi.useFakeTimers();
    try {
      const agent = makeAgent({
        agent: "TestCallableAgent",
        host: "localhost:8787",
        protocol: "ws",
        defaultCallTimeout: 25,
      });
      const socket = latestSocket();

      const pending = agent.call("slowStream", [], { stream: { onChunk: vi.fn() } });
      await vi.advanceTimersByTimeAsync(25);

      const request = JSON.parse(socket.sent[0]) as { id: string };
      dispatchMessage(socket, {
        type: MessageType.RPC,
        id: request.id,
        success: true,
        done: true,
        result: "ok",
      });

      await expect(pending).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("records terminal connection errors and stops new RPC calls", async () => {
    const onConnectionError = vi.fn();
    const agent = makeAgent({
      agent: "TestCallableAgent",
      host: "localhost:8787",
      protocol: "ws",
      onConnectionError,
    });
    const socket = latestSocket();

    socket.dispatchEvent(
      new CloseEvent("close", {
        code: 1008,
        reason: "unauthorized",
        wasClean: true,
      }),
    );

    expect(agent.connectionError).toMatchObject({
      name: "AgentConnectionError",
      code: 1008,
      reason: "unauthorized",
      wasClean: true,
    });
    expect(onConnectionError).toHaveBeenCalledWith(agent.connectionError);
    await expect(agent.call("afterTerminal", [])).rejects.toThrow("Connection closed");
  });

  it("keeps the socket reference across transient close events for PartySocket reconnects", async () => {
    const agent = makeAgent({
      agent: "TestCallableAgent",
      host: "localhost:8787",
      protocol: "ws",
    });
    const socket = latestSocket();

    const pending = agent.call("beforeReconnect", []);
    socket.dispatchEvent(new CloseEvent("close"));
    await expect(pending).rejects.toThrow("Connection closed");

    socket.dispatchEvent(new Event("open"));
    agent.setState({ reconnected: true });

    expect(agent.connected).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it("delays socket creation until an async query resolves", async () => {
    const query = deferred<Record<string, string | null>>();
    const agent = new Agent({
      agent: "TestStateAgent",
      name: "async-query",
      host: "localhost:8787",
      protocol: "ws",
      query: () => query.promise,
    });
    cleanups.push(() => agent.close());

    agent.connect();

    expect(MockPartySocket.instances).toHaveLength(0);
    expect(agent.queryStatus).toBe("loading");

    query.resolve({ token: "fresh" });
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });

    expect(latestSocket().options.query).toEqual({ token: "fresh" });
    expect(agent.queryStatus).toBe("ready");
    expect(agent.queryError).toBeNull();
  });

  it("deduplicates concurrent async query resolution for the same agent route", async () => {
    const query = deferred<Record<string, string | null>>();
    const queryFn = vi.fn(() => query.promise);
    const first = new Agent({
      agent: "TestStateAgent",
      name: "shared-query",
      host: "localhost:8787",
      protocol: "ws",
      query: queryFn,
    });
    const second = new Agent({
      agent: "TestStateAgent",
      name: "shared-query",
      host: "localhost:8787",
      protocol: "ws",
      query: queryFn,
    });
    cleanups.push(
      () => first.close(),
      () => second.close(),
    );

    first.connect();
    second.connect();

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
    query.resolve({ token: "shared" });
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(2);
    });
    expect(MockPartySocket.instances.map((socket) => socket.options.query)).toEqual([
      { token: "shared" },
      { token: "shared" },
    ]);
  });

  it("records async query errors and can retry with a later refresh", async () => {
    let fail = true;
    const queryFn = vi.fn(async () => {
      if (fail) throw new Error("token expired");
      return { token: "retried" };
    });
    const agent = new Agent({
      agent: "TestStateAgent",
      name: "query-retry",
      host: "localhost:8787",
      protocol: "ws",
      query: queryFn,
    });
    cleanups.push(() => agent.close());

    agent.connect();
    await vi.waitFor(() => {
      expect(agent.queryStatus).toBe("error");
    });

    expect(agent.queryError?.message).toBe("token expired");
    expect(MockPartySocket.instances).toHaveLength(0);

    fail = false;
    agent.refreshQuery();
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });

    expect(latestSocket().options.query).toEqual({ token: "retried" });
  });

  it("refreshes async query params after a transient close", async () => {
    let token = 0;
    const agent = new Agent({
      agent: "TestStateAgent",
      name: "query-reconnect",
      host: "localhost:8787",
      protocol: "ws",
      query: async () => ({ token: `token-${++token}` }),
    });
    cleanups.push(() => agent.close());

    agent.connect();
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });
    expect(MockPartySocket.instances[0].options.query).toEqual({ token: "token-1" });

    MockPartySocket.instances[0].dispatchEvent(new CloseEvent("close"));

    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(2);
    });
    expect(MockPartySocket.instances[1].options.query).toEqual({ token: "token-2" });
    expect(MockPartySocket.instances[0].close).toHaveBeenCalled();
  });

  it("does not refresh async query params after a terminal close", async () => {
    const queryFn = vi.fn(async () => ({ token: "token" }));
    const agent = new Agent({
      agent: "TestStateAgent",
      name: "query-terminal-close",
      host: "localhost:8787",
      protocol: "ws",
      query: queryFn,
    });
    cleanups.push(() => agent.close());

    agent.connect();
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });

    MockPartySocket.instances[0].dispatchEvent(
      new CloseEvent("close", {
        code: 1008,
        reason: "unauthorized",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(MockPartySocket.instances).toHaveLength(1);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(agent.connectionError?.code).toBe(1008);
  });

  it("ignores stale async query results when a newer refresh starts", async () => {
    const first = deferred<Record<string, string | null>>();
    const second = deferred<Record<string, string | null>>();
    const queryFn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const agent = new Agent({
      agent: "TestStateAgent",
      name: "query-stale",
      host: "localhost:8787",
      protocol: "ws",
      query: queryFn,
    });
    cleanups.push(() => agent.close());

    agent.connect();
    agent.refreshQuery();

    first.resolve({ token: "old" });
    await Promise.resolve();
    expect(MockPartySocket.instances).toHaveLength(0);

    second.resolve({ token: "new" });
    await vi.waitFor(() => {
      expect(MockPartySocket.instances).toHaveLength(1);
    });
    expect(latestSocket().options.query).toEqual({ token: "new" });
  });

  it("clears connection state and rejects pending RPCs on explicit close", async () => {
    const agent = makeAgent({
      agent: "TestCallableAgent",
      host: "localhost:8787",
      protocol: "ws",
    });
    const socket = latestSocket();

    dispatchMessage(socket, {
      type: MessageType.CF_AGENT_IDENTITY,
      name: "room-1",
      agent: "test-callable-agent",
    });
    socket.dispatchEvent(new Event("open"));
    const pending = agent.call("add", [1, 2]);

    agent.close();

    expect(agent.connected).toBe(false);
    expect(agent.identity.identified).toBe(false);
    await expect(pending).rejects.toThrow("Connection closed");
  });
});
