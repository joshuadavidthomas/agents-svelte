import { vi } from "vitest";
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
  send: ReturnType<typeof vi.fn>;
}

export function createMockAgent(params?: {
  name?: string;
  agent?: string;
  url?: string;
}): MockAgent {
  const name = params?.name ?? "mock-room";
  const agentKebab = params?.agent ?? "chat";
  const url = params?.url ?? `ws://localhost:3000/agents/${agentKebab}/${name}`;

  const target = new EventTarget();
  const sent: string[] = [];
  const sentMessages: Array<Record<string, unknown>> = [];

  const send = vi.fn((payload: string) => {
    sent.push(payload);
    try {
      sentMessages.push(JSON.parse(payload));
    } catch {
      // non-JSON payload
    }
  });

  const socket = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    send,
    close: vi.fn(),
    readyState: 1,
    _pkurl: url,
  } as unknown as Agent<unknown, unknown>["socket"];

  const agent = {
    socket,
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
    target.dispatchEvent(new MessageEvent("message", { data: payload }));
  }

  function dispatchClose() {
    target.dispatchEvent(new CloseEvent("close"));
  }

  return {
    agent,
    sent,
    sentMessages,
    dispatchServerMessage,
    dispatchClose,
    send,
  };
}
