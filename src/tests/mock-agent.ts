import { vi } from "vitest";
import { createSubscriber } from "svelte/reactivity";
import type { Agent } from "../agent.svelte.ts";

export interface MockAgent {
  agent: Agent<unknown, unknown>;
  /** Captured socket.send payloads as raw strings. */
  sent: string[];
  /** Parsed wire-protocol payloads sent via socket.send. */
  sentMessages: Array<Record<string, unknown>>;
  /** Dispatch a message event on the socket (simulating server → client). */
  dispatchServerMessage: (data: unknown) => void;
  /** Dispatch a close event. */
  dispatchClose: () => void;
  /** Dispatch an open event after a physical reconnect. */
  dispatchOpen: () => void;
  /** Replace the current socket with an independent open socket. */
  replaceSocket: () => {
    dispatchPreviousServerMessage: (data: unknown) => void;
  };
  setReadyState: (state: number) => void;
  send: ReturnType<typeof vi.fn>;
}

export function createMockAgent(params?: {
  name?: string;
  agent?: string;
  url?: string;
  readyState?: number;
}): MockAgent {
  const name = params?.name ?? "mock-room";
  const agentKebab = params?.agent ?? "chat";
  const url = params?.url ?? `ws://localhost:3000/agents/${agentKebab}/${name}`;

  const sent: string[] = [];
  const sentMessages: Array<Record<string, unknown>> = [];
  let notifySocketChanged: (() => void) | undefined;
  const subscribeSocket = createSubscriber((update) => {
    notifySocketChanged = update;
    return () => {
      notifySocketChanged = undefined;
    };
  });

  const send = vi.fn((payload: string) => {
    sent.push(payload);
    try {
      sentMessages.push(JSON.parse(payload));
    } catch {
      // non-JSON payload
    }
  });

  function createSocket(initialReadyState = 1) {
    const target = new EventTarget();
    let readyState = initialReadyState;
    const socket = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
      send,
      close: vi.fn(),
      get readyState() {
        return readyState;
      },
      _pkurl: url,
    } as unknown as Agent<unknown, unknown>["socket"];
    return {
      socket,
      target,
      setReadyState: (state: number) => {
        readyState = state;
      },
    };
  }

  let current = createSocket(params?.readyState ?? 1);

  const agent = {
    get socket() {
      subscribeSocket();
      return current.socket;
    },
    path: [{ agent: agentKebab, name }],
    state: undefined,
    identity: { name, agent: agentKebab, identified: true },
    connected: true,
    stateError: null,
    mcp: null,
    ready: Promise.resolve(),
    stub: {} as Agent<unknown, unknown>["stub"],
    call: (() => Promise.resolve()) as Agent<unknown, unknown>["call"],
    connect: () => {},
    setState: () => {},
    getHttpUrl: () => url.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://"),
    close: () => {},
  } as unknown as Agent<unknown, unknown>;

  function dispatchServerMessage(data: unknown) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    current.target.dispatchEvent(new MessageEvent("message", { data: payload }));
  }

  function dispatchClose() {
    current.setReadyState(3);
    current.target.dispatchEvent(new CloseEvent("close"));
  }

  function dispatchOpen() {
    current.setReadyState(1);
    current.target.dispatchEvent(new Event("open"));
  }

  return {
    agent,
    sent,
    sentMessages,
    dispatchServerMessage,
    dispatchClose,
    dispatchOpen,
    replaceSocket: () => {
      const previous = current;
      current = createSocket();
      notifySocketChanged?.();
      return {
        dispatchPreviousServerMessage: (data: unknown) => {
          const payload = typeof data === "string" ? data : JSON.stringify(data);
          previous.target.dispatchEvent(new MessageEvent("message", { data: payload }));
        },
      };
    },
    setReadyState: (state) => {
      current.setReadyState(state);
    },
    send,
  };
}
