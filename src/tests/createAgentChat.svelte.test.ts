import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import type { UIMessage } from "ai";
import { MessageType } from "@cloudflare/ai-chat/types";
import { AgentChat, getAgentMessages, type CreateAgentChatOptions } from "../chat.svelte.ts";
import { createMockAgent, type MockAgent } from "./mock-agent.ts";
import {
  dispatchStaleWeatherApprovalSync,
  dispatchWeatherApprovalContinuationFinish,
  dispatchWeatherApprovalContinuationStart,
  expectedWeatherApprovalFinalParts,
  weatherApprovalFlow,
  weatherApprovalInitialMessages,
} from "./human-loop-flow.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()?.();
    } catch {
      // ignore
    }
  }
});

async function waitForChatInitialized(chat: { initialized: boolean }, timeout = 2000) {
  await vi.waitFor(
    () => {
      expect(chat.initialized).toBe(true);
    },
    { timeout },
  );
}

function findSent(mock: MockAgent, type: string): Record<string, unknown> | undefined {
  return mock.sentMessages.find((m) => m.type === type);
}

function findSentAll(mock: MockAgent, type: string): Record<string, unknown>[] {
  return mock.sentMessages.filter((m) => m.type === type);
}

function makeChat<M extends UIMessage = UIMessage>(
  mock: MockAgent,
  overrides: Partial<CreateAgentChatOptions<M>> = {},
): AgentChat<M> {
  const chat = new AgentChat<M>({
    agent: mock.agent,
    getInitialMessages: null,
    resume: false,
    ...overrides,
  });
  chat.connect();
  cleanups.push(() => chat.close());
  return chat;
}

function seedToolPart(toolCallId: string, toolName: string): UIMessage {
  return {
    id: `asst-${toolCallId}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId,
        state: "input-available",
        input: {},
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

describe("createAgentChat — initial messages", () => {
  it("can be constructed directly outside component initialization", async () => {
    const mock = createMockAgent();
    const chat = new AgentChat({
      agent: mock.agent,
      getInitialMessages: null,
      resume: false,
      initialMessages: [seedToolPart("direct-call", "foo")],
    });
    chat.connect();
    cleanups.push(() => chat.close());

    await waitForChatInitialized(chat);

    expect(chat.pendingToolCalls[0]?.toolCallId).toBe("direct-call");
  });

  it("does not apply initial messages after close", async () => {
    const mock = createMockAgent({ name: `closed-init-${Date.now()}` });
    let resolveMessages!: (messages: UIMessage[]) => void;
    const getInitialMessages = vi.fn(
      () =>
        new Promise<UIMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const chat = new AgentChat({
      agent: mock.agent,
      getInitialMessages,
      resume: false,
    });
    chat.connect();
    cleanups.push(() => chat.close());

    chat.close();
    resolveMessages([{ id: "late", role: "assistant", parts: [{ type: "text", text: "late" }] }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chat.initialized).toBe(false);
    expect(chat.messages).toEqual([]);
  });

  it("uses initialMessages when getInitialMessages is null", async () => {
    const mock = createMockAgent();
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    const chat = makeChat(mock, {
      initialMessages: messages,
    });
    await waitForChatInitialized(chat);
    expect(chat.messages).toEqual(messages);
  });

  it("calls getInitialMessages callback and loads returned messages", async () => {
    const mock = createMockAgent({ name: "alpha" });
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
      },
    ];
    const fetcher = vi.fn(async (_opts: { agent: string; name: string; url: string }) => messages);

    const chat = makeChat(mock, { getInitialMessages: fetcher });
    await waitForChatInitialized(chat);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0]?.[0];
    expect(call?.agent).toBe("chat");
    expect(call?.name).toBe("alpha");
    expect(chat.messages).toEqual(messages);
  });

  it("fetches /get-messages by default when getInitialMessages is omitted", async () => {
    const name = `default-fetch-${Date.now()}-${Math.random()}`;
    const mock = createMockAgent({
      name,
      url: `ws://localhost:3000/agents/chat/${name}?_pk=test&token=abc`,
    });
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "from fetch" }],
      },
    ];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(messages), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    try {
      const chat = makeChat(mock, { getInitialMessages: undefined });
      await waitForChatInitialized(chat);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `http://localhost:3000/agents/chat/${name}/get-messages?token=abc`,
      );
      expect(chat.messages).toEqual(messages);
      expect(chat.initialLoadError).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("merges late initial messages with an immediate first send", async () => {
    const mock = createMockAgent({ name: "late-hydration-first-send" });
    let resolveMessages!: (messages: UIMessage[]) => void;
    const getInitialMessages = vi.fn(
      () =>
        new Promise<UIMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const chat = makeChat(mock, { getInitialMessages });

    void chat.sendMessage({ text: "First message" }).catch(() => {});

    await vi.waitFor(() => {
      expect(chat.messages.some((message) => message.role === "user")).toBe(true);
    });

    resolveMessages([
      {
        id: "persisted-history",
        role: "assistant",
        parts: [{ type: "text", text: "Persisted history" }],
      },
    ]);
    await waitForChatInitialized(chat);

    expect(chat.messages[0]).toMatchObject({ id: "persisted-history" });
    expect(chat.messages.some((message) => JSON.stringify(message).includes("First message"))).toBe(
      true,
    );
  });

  it("does not hydrate late initial messages after a deliberate clear", async () => {
    const mock = createMockAgent({ name: "late-hydration-cleared" });
    let resolveMessages!: (messages: UIMessage[]) => void;
    const getInitialMessages = vi.fn(
      () =>
        new Promise<UIMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const chat = makeChat(mock, { getInitialMessages });

    chat.clearHistory();
    resolveMessages([
      {
        id: "stale-history",
        role: "assistant",
        parts: [{ type: "text", text: "Stale history" }],
      },
    ]);
    await waitForChatInitialized(chat);

    expect(chat.messages).toEqual([]);
  });

  it("surfaces default fetch errors via initialLoadError and still initializes", async () => {
    const name = `default-fetch-error-${Date.now()}-${Math.random()}`;
    const mock = createMockAgent({
      name,
      url: `ws://localhost:3000/agents/chat/${name}?_pk=test`,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", {
        status: 500,
        statusText: "Server Error",
      }),
    );

    try {
      const chat = makeChat(mock, { getInitialMessages: undefined });
      await waitForChatInitialized(chat);

      expect(chat.initialLoadError?.message).toBe(
        "[agents-svelte/chat] Failed to load initial messages: 500 Server Error",
      );
      expect(chat.messages).toEqual([]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws from getAgentMessages on failed HTTP responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", {
        status: 404,
        statusText: "Not Found",
      }),
    );

    try {
      await expect(getAgentMessages({ url: "http://localhost/get-messages" })).rejects.toThrow(
        "[agents-svelte/chat] Failed to load initial messages: 404 Not Found",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws from getAgentMessages on invalid JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json"));

    try {
      await expect(getAgentMessages({ url: "http://localhost/get-messages" })).rejects.toThrow(
        "[agents-svelte/chat] Failed to parse initial messages",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws from getAgentMessages on network failures", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    try {
      await expect(getAgentMessages({ url: "http://localhost/get-messages" })).rejects.toThrow(
        "offline",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("does not overwrite socket-pushed messages with slower initial messages", async () => {
    const mock = createMockAgent();
    let resolveMessages!: (messages: UIMessage[]) => void;
    const chat = makeChat(mock, {
      getInitialMessages: () =>
        new Promise<UIMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    });

    const pushed: UIMessage[] = [
      {
        id: "pushed",
        role: "assistant",
        parts: [{ type: "text", text: "pushed" }],
      },
    ];
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: pushed,
    });
    flushSync();

    resolveMessages([
      {
        id: "stale",
        role: "assistant",
        parts: [{ type: "text", text: "stale" }],
      },
    ]);
    await waitForChatInitialized(chat);

    expect(chat.messages).toEqual(pushed);
  });

  it("surfaces initial load errors via initialLoadError and still initializes", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      getInitialMessages: async () => {
        throw new Error("boom");
      },
    });

    await waitForChatInitialized(chat);

    expect(chat.initialLoadError?.message).toBe("boom");
    expect(chat.messages).toEqual([]);
  });
});

describe("createAgentChat — setMessages", () => {
  it("replaces messages locally and syncs to server", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const next: UIMessage[] = [
      {
        id: "x",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    chat.setMessages(next);
    flushSync();

    expect(chat.messages).toEqual(next);
    const sent = findSent(mock, MessageType.CF_AGENT_CHAT_MESSAGES);
    expect(sent).toBeDefined();
    expect(sent!.messages).toEqual(next);
  });

  it("accepts a functional updater", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [{ id: "a", role: "user", parts: [{ type: "text", text: "a" }] }],
    });
    await waitForChatInitialized(chat);

    chat.setMessages((prev) => [
      ...prev,
      { id: "b", role: "user", parts: [{ type: "text", text: "b" }] },
    ]);
    flushSync();

    expect(chat.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("ignores setMessages after close", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [{ id: "a", role: "user", parts: [{ type: "text", text: "a" }] }],
    });
    await waitForChatInitialized(chat);

    chat.close();
    chat.setMessages([{ id: "b", role: "user", parts: [{ type: "text", text: "b" }] }]);
    flushSync();

    expect(chat.messages.map((message) => message.id)).toEqual(["a"]);
    expect(findSent(mock, MessageType.CF_AGENT_CHAT_MESSAGES)).toBeUndefined();
  });

  it("skips server sync when skipServerSync is true", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.setMessages([{ id: "z", role: "user", parts: [{ type: "text", text: "z" }] }], {
      skipServerSync: true,
    });
    flushSync();

    expect(findSent(mock, MessageType.CF_AGENT_CHAT_MESSAGES)).toBeUndefined();
  });
});

describe("createAgentChat — clearHistory", () => {
  it("wipes local messages and sends CF_AGENT_CHAT_CLEAR", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [{ id: "a", role: "user", parts: [{ type: "text", text: "a" }] }],
    });
    await waitForChatInitialized(chat);

    chat.clearHistory();
    flushSync();

    expect(chat.messages).toEqual([]);
    expect(findSent(mock, MessageType.CF_AGENT_CHAT_CLEAR)).toBeDefined();
  });

  it("resets server streaming state immediately", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUME_NONE,
    });
    flushSync();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "stream-clear",
    });
    flushSync();
    expect(chat.isServerStreaming).toBe(true);

    chat.clearHistory();
    flushSync();

    expect(chat.isServerStreaming).toBe(false);
    expect(chat.isStreaming).toBe(false);
  });

  it("sends client tool schemas with chat requests", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      clientTools: () => [
        {
          name: "getLocation",
          description: "Get the current location.",
          parameters: { type: "object" },
        },
      ],
    });
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" });

    await vi.waitFor(() => {
      const request = findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST);
      expect(request).toBeDefined();
      const body = JSON.parse(String((request?.init as { body?: string } | undefined)?.body));
      expect(body.clientTools).toEqual([
        {
          name: "getLocation",
          description: "Get the current location.",
          parameters: { type: "object" },
        },
      ]);
    });
  });

  it("does not cancel the server turn on local close by default", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" }).catch(() => {});

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toBeDefined();
    });

    chat.close();

    expect(findSent(mock, MessageType.CF_AGENT_CHAT_REQUEST_CANCEL)).toBeUndefined();
  });

  it("cancels the server turn on local close when requested", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { cancelOnClientAbort: true });
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" }).catch(() => {});

    let requestId = "";
    await vi.waitFor(() => {
      requestId = String(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)?.id ?? "");
      expect(requestId).not.toBe("");
    });

    chat.close();

    expect(findSent(mock, MessageType.CF_AGENT_CHAT_REQUEST_CANCEL)).toMatchObject({
      id: requestId,
    });
  });

  it("cancels the server turn on explicit stop", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" }).catch(() => {});

    let requestId = "";
    await vi.waitFor(() => {
      requestId = String(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)?.id ?? "");
      expect(requestId).not.toBe("");
    });

    await chat.stop();

    expect(findSent(mock, MessageType.CF_AGENT_CHAT_REQUEST_CANCEL)).toMatchObject({
      id: requestId,
    });
  });

  it("ignores late chunks from an active local stream after clearing", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" });

    let requestId = "";
    await vi.waitFor(() => {
      requestId = String(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)?.id ?? "");
      expect(requestId).not.toBe("");
    });

    chat.clearHistory();
    flushSync();
    expect(chat.messages).toEqual([]);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"start","messageId":"late-assistant"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"text-start","id":"late-text"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"text-delta","id":"late-text","delta":"late"}',
      done: false,
    });
    flushSync();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chat.messages).toEqual([]);
  });

  it("ignores late chunks from an active resumed stream after clearing", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "resume-clear",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-clear",
      body: '{"type":"start","messageId":"resume-assistant"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-clear",
      body: '{"type":"text-start","id":"resume-text"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-clear",
      body: '{"type":"text-delta","id":"resume-text","delta":"before"}',
      done: false,
    });

    await vi.waitFor(() => {
      expect(chat.messages.some((message) => message.id === "resume-assistant")).toBe(true);
    });

    chat.clearHistory();
    flushSync();
    expect(chat.messages).toEqual([]);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-clear",
      body: '{"type":"text-delta","id":"resume-text","delta":" after"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-clear",
      body: "",
      done: true,
    });
    flushSync();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chat.messages).toEqual([]);
  });
});

describe("createAgentChat — tool output wire protocol", () => {
  it("toolCall.addOutput sends CF_AGENT_TOOL_RESULT and updates the local part", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-1", "getWeather")],
      clientTools: [{ name: "getWeather", parameters: { type: "object" } }],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();
    toolCall!.addOutput({ output: { temp: 72 } });
    flushSync();

    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toMatchObject({
      toolCallId: "call-1",
      toolName: "getWeather",
      output: { temp: 72 },
      autoContinue: true,
      clientTools: [{ name: "getWeather", parameters: { type: "object" } }],
    });

    const toolPart = chat.messages[0]?.parts[0] as {
      state?: string;
      output?: unknown;
    };
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toEqual({ temp: 72 });
  });

  it("toolCall.addOutput with state=output-error disables autoContinue", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-2", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();
    toolCall!.addOutput({ state: "output-error", errorText: "failed" });
    flushSync();

    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toMatchObject({
      toolCallId: "call-2",
      toolName: "getWeather",
      state: "output-error",
      errorText: "failed",
      autoContinue: false,
    });

    const toolPart = chat.messages[0]?.parts[0] as {
      state?: string;
      errorText?: string;
    };
    expect(toolPart.state).toBe("output-error");
    expect(toolPart.errorText).toBe("failed");
  });

  it("respects autoContinueAfterToolResult=false", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      initialMessages: [seedToolPart("call-3", "foo")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();
    toolCall!.addOutput({ output: {} });
    flushSync();

    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent?.autoContinue).toBe(false);
  });

  it("does not expose the inherited chat-level addToolOutput API", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    expect((chat as unknown as { addToolOutput?: unknown }).addToolOutput).toBeUndefined();
    expect((chat as unknown as { addToolResult?: unknown }).addToolResult).toBeUndefined();
  });

  it("toolCall.addOutput no-ops after close", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-closed", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();
    chat.close();
    toolCall!.addOutput({ output: { temp: 72 } });
    flushSync();

    expect(findSentAll(mock, MessageType.CF_AGENT_TOOL_RESULT)).toEqual([]);
  });

  it("stop aborts an attached tool continuation", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-abort", "getWeather")],
    });
    await waitForChatInitialized(chat);

    chat.pendingToolCalls[0]!.addOutput({ output: { temp: 72 } });

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "continuation-abort",
    });
    await chat.stop();

    expect(findSent(mock, MessageType.CF_AGENT_CHAT_REQUEST_CANCEL)).toMatchObject({
      id: "continuation-abort",
    });
  });

  it("toolCall.addOutput updates a retained historical handle", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-history", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();

    chat.messages = [
      ...chat.messages,
      {
        id: "later-user",
        role: "user",
        parts: [{ type: "text", text: "later" }],
      },
    ];
    flushSync();
    expect(chat.pendingToolCalls).toEqual([]);

    toolCall!.addOutput({ output: { temp: 72 } });
    flushSync();

    const toolPart = chat.messages[0]?.parts[0] as {
      state?: string;
      output?: unknown;
    };
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toEqual({ temp: 72 });
  });

  it("toolCall.addOutput is idempotent", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-once", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();
    toolCall!.addOutput({ output: { temp: 72 } });
    toolCall!.addOutput({ output: { temp: 73 } });
    flushSync();

    const sent = findSentAll(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.output).toEqual({ temp: 72 });
  });

  it("sendAutomaticallyWhen is not called when server auto-continuation is enabled", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => true);
    const chat = makeChat(mock, {
      sendAutomaticallyWhen,
      initialMessages: [seedToolPart("call-auto-server", "foo")],
    });
    await waitForChatInitialized(chat);

    chat.pendingToolCalls[0]!.addOutput({ output: {} });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendAutomaticallyWhen).not.toHaveBeenCalled();
    expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toEqual([]);
  });

  it("sendAutomaticallyWhen can continue from the client when server auto-continuation is disabled", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => true);
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      sendAutomaticallyWhen,
      initialMessages: [seedToolPart("call-auto-client", "foo")],
    });
    await waitForChatInitialized(chat);

    chat.pendingToolCalls[0]!.addOutput({ output: {} });
    flushSync();

    await vi.waitFor(() => {
      expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toHaveLength(1);
    });
  });

  it("sendAutomaticallyWhen can decline client continuation", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => false);
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      sendAutomaticallyWhen,
      initialMessages: [seedToolPart("call-no-client", "foo")],
    });
    await waitForChatInitialized(chat);

    chat.pendingToolCalls[0]!.addOutput({ output: {} });
    flushSync();
    await vi.waitFor(() => expect(sendAutomaticallyWhen).toHaveBeenCalled());

    expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toEqual([]);
  });

  it("sends at most one client continuation after multiple tool outputs", async () => {
    const mock = createMockAgent();
    let resolveShouldSend!: (value: boolean) => void;
    const shouldSend = new Promise<boolean>((resolve) => {
      resolveShouldSend = resolve;
    });
    const sendAutomaticallyWhen = () => shouldSend;
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      sendAutomaticallyWhen,
      initialMessages: [
        {
          id: "asst-concurrent",
          role: "assistant",
          parts: [
            {
              type: "tool-foo",
              toolCallId: "call-a",
              state: "input-available",
              input: {},
            } as unknown as UIMessage["parts"][number],
            {
              type: "tool-bar",
              toolCallId: "call-b",
              state: "input-available",
              input: {},
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    const [firstToolCall, secondToolCall] = chat.pendingToolCalls;
    expect(firstToolCall).toBeDefined();
    expect(secondToolCall).toBeDefined();

    firstToolCall!.addOutput({ output: { ok: "a" } });
    secondToolCall!.addOutput({ output: { ok: "b" } });
    resolveShouldSend(true);
    flushSync();

    await vi.waitFor(() => {
      expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toHaveLength(1);
    });
  });
});

describe("createAgentChat — approval wire protocol", () => {
  it("addToolApprovalResponse sends CF_AGENT_TOOL_APPROVAL when part exists", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [
        {
          id: "asst-1",
          role: "assistant",
          parts: [
            {
              type: "tool-delete-file",
              toolCallId: "call-9",
              state: "approval-requested",
              approval: { id: "appr-1" },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    chat.addToolApprovalResponse({ id: "appr-1", approved: true });
    flushSync();

    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_APPROVAL);
    expect(sent).toMatchObject({
      toolCallId: "call-9",
      approved: true,
      autoContinue: true,
    });
  });

  it("marks denied approvals as output-denied locally", async () => {
    const mock = createMockAgent();
    const chat = makeChat<UIMessage>(mock, {
      initialMessages: [
        {
          id: "asst-denied-approval",
          role: "assistant",
          parts: [
            {
              type: "tool-delete-file",
              toolCallId: "call-denied-approval",
              state: "approval-requested",
              approval: { id: "appr-denied" },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    chat.addToolApprovalResponse({ id: "appr-denied", approved: false });
    flushSync();

    const approvalPart = chat.messages[0]?.parts[0] as {
      state?: string;
      approval?: { approved?: boolean };
    };
    expect(approvalPart.state).toBe("output-denied");
    expect(approvalPart.approval?.approved).toBe(false);
    expect(findSent(mock, MessageType.CF_AGENT_TOOL_APPROVAL)).toMatchObject({
      toolCallId: "call-denied-approval",
      approved: false,
    });
  });

  it("sendAutomaticallyWhen is not called for approval when server auto-continuation is enabled", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => true);
    const chat = makeChat(mock, {
      sendAutomaticallyWhen,
      initialMessages: [
        {
          id: "asst-approval-server-auto",
          role: "assistant",
          parts: [
            {
              type: "tool-delete-file",
              toolCallId: "call-approval-server-auto",
              state: "approval-requested",
              approval: { id: "appr-server-auto" },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    chat.addToolApprovalResponse({ id: "appr-server-auto", approved: true });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendAutomaticallyWhen).not.toHaveBeenCalled();
    expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toEqual([]);
  });

  it("sendAutomaticallyWhen can continue from approval when server auto-continuation is disabled", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => true);
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      sendAutomaticallyWhen,
      initialMessages: [
        {
          id: "asst-approval-auto",
          role: "assistant",
          parts: [
            {
              type: "tool-delete-file",
              toolCallId: "call-approval-auto",
              state: "approval-requested",
              approval: { id: "appr-auto" },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    chat.addToolApprovalResponse({ id: "appr-auto", approved: true });
    flushSync();

    await vi.waitFor(() => {
      expect(sendAutomaticallyWhen).toHaveBeenCalled();
      expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toHaveLength(1);
    });
  });

  it("updates a historical approval part", async () => {
    const mock = createMockAgent();
    const chat = makeChat<UIMessage>(mock, {
      initialMessages: [
        {
          id: "asst-approval-history",
          role: "assistant",
          parts: [
            {
              type: "tool-delete-file",
              toolCallId: "call-approval-history",
              state: "approval-requested",
              approval: { id: "appr-history" },
            } as unknown as UIMessage["parts"][number],
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    chat.messages = [
      ...chat.messages,
      {
        id: "later-user",
        role: "user",
        parts: [{ type: "text", text: "later" }],
      },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chat.addToolApprovalResponse({ id: "appr-history", approved: true });
    chat.addToolApprovalResponse({ id: "appr-history", approved: true });
    flushSync();

    expect(findSentAll(mock, MessageType.CF_AGENT_TOOL_APPROVAL)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const approvalPart = chat.messages[0]?.parts[0] as {
      state?: string;
      approval?: { approved?: boolean };
    };
    expect(approvalPart.state).toBe("approval-responded");
    expect(approvalPart.approval?.approved).toBe(true);
  });

  it("does not continue from the client when approval id is missing", async () => {
    const mock = createMockAgent();
    const sendAutomaticallyWhen = vi.fn(() => true);
    const chat = makeChat(mock, {
      autoContinueAfterToolResult: false,
      sendAutomaticallyWhen,
    });
    await waitForChatInitialized(chat);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chat.addToolApprovalResponse({ id: "missing", approved: true });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(warn).toHaveBeenCalled();
    expect(sendAutomaticallyWhen).not.toHaveBeenCalled();
    expect(findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)).toEqual([]);
    warn.mockRestore();
  });

  it("warns when no matching approval part exists", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chat.addToolApprovalResponse({ id: "missing", approved: false });
    flushSync();
    await new Promise((r) => setTimeout(r, 20));

    expect(findSent(mock, MessageType.CF_AGENT_TOOL_APPROVAL)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createAgentChat — server-initiated messages", () => {
  it("CF_AGENT_CHAT_CLEAR wipes local state", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [{ id: "a", role: "user", parts: [{ type: "text", text: "a" }] }],
    });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_CHAT_CLEAR });
    flushSync();

    expect(chat.messages).toEqual([]);
  });

  it("CF_AGENT_CHAT_MESSAGES replaces local messages", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const next: UIMessage[] = [
      {
        id: "server-msg",
        role: "assistant",
        parts: [{ type: "text", text: "from server" }],
      },
    ];
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: next,
    });
    flushSync();

    expect(chat.messages).toEqual(next);
  });

  it("CF_AGENT_MESSAGE_UPDATED updates an existing message", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [
        {
          id: "message-updated",
          role: "assistant",
          parts: [{ type: "text", text: "old" }],
        },
      ],
    });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_MESSAGE_UPDATED,
      message: {
        id: "message-updated",
        role: "assistant",
        parts: [{ type: "text", text: "new" }],
      },
    });
    flushSync();

    expect(chat.messages).toEqual([
      {
        id: "message-updated",
        role: "assistant",
        parts: [{ type: "text", text: "new" }],
      },
    ]);
  });

  it("CF_AGENT_MESSAGE_UPDATED can match an existing message by toolCallId", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-update", "getWeather")],
    });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_MESSAGE_UPDATED,
      message: {
        id: "server-rewritten-id",
        role: "assistant",
        parts: [
          {
            type: "tool-getWeather",
            toolCallId: "call-update",
            state: "output-available",
            output: { temp: 72 },
          },
        ],
      },
    });
    flushSync();

    const updatedPart = chat.messages[0]?.parts[0] as { output?: unknown } | undefined;
    expect(chat.messages[0]?.id).toBe("asst-call-update");
    expect(updatedPart?.output).toEqual({ temp: 72 });
  });

  it("initial resume attaches to the announced stream", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "resume-success",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-success",
      body: '{"type":"start","messageId":"resumed-assistant"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-success",
      body: '{"type":"text-start","id":"resumed-text"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-success",
      body: '{"type":"text-delta","id":"resumed-text","delta":"resumed"}',
      done: false,
    });

    await vi.waitFor(() => {
      expect(chat.messages.map((message) => message.id)).toEqual(["resumed-assistant"]);
    });

    expect(chat.isServerStreaming).toBe(false);
    expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK)).toMatchObject({
      id: "resume-success",
    });
  });

  it("CF_AGENT_STREAM_RESUMING triggers fallback and ACK when no active resume", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    // Resolve the transport's initial resumeStream() so it's no longer
    // awaiting — then STREAM_RESUMING hits our fallback path.
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUME_NONE,
    });
    flushSync();
    mock.sent.length = 0;
    mock.sentMessages.length = 0;

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "stream-abc",
    });
    flushSync();

    expect(chat.isServerStreaming).toBe(true);
    const ack = findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK);
    expect(ack).toMatchObject({ id: "stream-abc" });
  });

  it("calls onData for server-pushed data chunks", async () => {
    const mock = createMockAgent();
    const onData = vi.fn();
    const chat = makeChat(mock, { resume: true, onData });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUME_NONE });
    flushSync();
    mock.sent.length = 0;
    mock.sentMessages.length = 0;

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "data-stream" });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "data-stream",
      body: '{"type":"data-progress","data":{"step":1}}',
      done: false,
    });
    flushSync();

    expect(onData).toHaveBeenCalledWith({ type: "data-progress", data: { step: 1 } });
  });

  it("ignores unsolicited stream resume when resume is disabled", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: false });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "ignored-resume",
    });
    flushSync();

    expect(chat.isServerStreaming).toBe(false);
    expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK)).toBeUndefined();
  });
});

describe("createAgentChat — replay parity", () => {
  function seededReplayChat(mock: MockAgent) {
    return makeChat(mock, {
      resume: true,
      initialMessages: [
        {
          id: "asst-1",
          role: "assistant",
          parts: [{ type: "text", text: "old hydrated" }],
        },
      ],
    });
  }

  async function finishInitialResume(mock: MockAgent) {
    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });
    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUME_NONE });
    flushSync();
    mock.sent.length = 0;
    mock.sentMessages.length = 0;
  }

  it("clears hydrated assistant parts when replay starts for the same message", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "replay-1" });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-1",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]?.id).toBe("asst-1");
    expect(chat.messages[0]?.parts).toEqual([]);
  });

  it("rebuilds replayed text without retaining hydrated text", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "replay-2" });
    for (const body of [
      '{"type":"start","messageId":"asst-1"}',
      '{"type":"text-start","id":"text-1"}',
      '{"type":"text-delta","id":"text-1","delta":"new"}',
      '{"type":"text-delta","id":"text-1","delta":" content"}',
      '{"type":"text-end","id":"text-1"}',
    ]) {
      mock.dispatchServerMessage({
        type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
        id: "replay-2",
        replay: true,
        body,
      });
    }
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-2",
      replay: true,
      replayComplete: true,
      done: true,
      body: "",
    });
    flushSync();

    expect(JSON.stringify(chat.messages)).not.toContain("old hydrated");
    expect(chat.messages[0]?.parts).toEqual([{ type: "text", text: "new content", state: "done" }]);
  });

  it("drops replay chunks without a prior stream-resuming message", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "stale-replay",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    expect(chat.messages[0]?.parts).toEqual([{ type: "text", text: "old hydrated" }]);
    expect(chat.isServerStreaming).toBe(false);
  });

  it("clears replay pending state after replay completes", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "replay-3" });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-3",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-3",
      replay: true,
      replayComplete: true,
      done: true,
      body: "",
    });
    flushSync();

    chat.messages = [
      { id: "asst-1", role: "assistant", parts: [{ type: "text", text: "rebuilt" }] },
    ];
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-3",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    expect(chat.messages[0]?.parts).toEqual([{ type: "text", text: "rebuilt" }]);
  });

  it("clearHistory wipes pending replay state", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "replay-clear" });
    flushSync();
    chat.clearHistory();
    flushSync();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-clear",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    expect(chat.messages).toEqual([]);
  });

  it("local resume replay clears hydrated assistant parts", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });
    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUMING, id: "local-replay" });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "local-replay",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    expect(chat.messages[0]?.parts).toEqual([]);
    expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK)).toMatchObject({
      id: "local-replay",
    });
  });

  it("collapses hydrated replay text prefixes", async () => {
    const mock = createMockAgent();
    const chat = seededReplayChat(mock);
    await waitForChatInitialized(chat);
    await finishInitialResume(mock);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "replay-collapse",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "replay-collapse",
      replay: true,
      body: '{"type":"start","messageId":"asst-1"}',
    });
    flushSync();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_MESSAGE_UPDATED,
      message: {
        id: "asst-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Hello" },
          { type: "text", text: "Hello, world" },
        ],
      },
    });
    flushSync();

    await vi.waitFor(() => {
      expect(chat.messages[0]?.parts).toEqual([{ type: "text", text: "Hello, world" }]);
    });
  });
});

describe("createAgentChat — pendingToolCalls", () => {
  it("exposes input-available tool parts as reactive tool call handles", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.messages = [
      {
        id: "asst-1",
        role: "assistant",
        parts: [
          {
            type: "tool-getWeather",
            toolCallId: "call-1",
            state: "input-available",
            input: { city: "SF" },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ];
    flushSync();

    await vi.waitFor(() => {
      expect(chat.pendingToolCalls).toHaveLength(1);
    });

    const [toolCall] = chat.pendingToolCalls;
    expect(toolCall?.toolCallId).toBe("call-1");
    expect(toolCall?.toolName).toBe("getWeather");
    expect(toolCall?.messageId).toBe("asst-1");
    expect(toolCall?.input).toEqual({ city: "SF" });
  });

  it("tracks tool calls when the last assistant message is replaced in place", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.messages = [
      {
        id: "asst-1",
        role: "assistant",
        parts: [{ type: "text", text: "waiting" }],
      },
    ];
    flushSync();
    expect(chat.pendingToolCalls).toEqual([]);

    chat.messages = [
      {
        id: "asst-1",
        role: "assistant",
        parts: [
          {
            type: "tool-foo",
            toolCallId: "call-replaced",
            state: "input-available",
            input: { x: 1 },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ];
    flushSync();

    await vi.waitFor(() => {
      expect(chat.pendingToolCalls).toHaveLength(1);
      expect(chat.pendingToolCalls[0]?.toolCallId).toBe("call-replaced");
    });
  });

  it("exposes multiple current tool calls and resolves them independently", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.messages = [
      {
        id: "asst-multi",
        role: "assistant",
        parts: [
          {
            type: "tool-foo",
            toolCallId: "call-a",
            state: "input-available",
            input: { a: 1 },
          } as unknown as UIMessage["parts"][number],
          {
            type: "tool-bar",
            toolCallId: "call-b",
            state: "input-available",
            input: { b: 2 },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ];
    flushSync();

    await vi.waitFor(() => {
      expect(chat.pendingToolCalls.map((toolCall) => toolCall.toolCallId)).toEqual([
        "call-a",
        "call-b",
      ]);
    });

    chat.pendingToolCalls[0]?.addOutput({ output: { ok: "a" } });
    flushSync();

    expect(chat.pendingToolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(["call-b"]);
    expect(findSentAll(mock, MessageType.CF_AGENT_TOOL_RESULT)).toHaveLength(1);
  });

  it("clears pending tool calls when history is cleared", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-clear", "foo")],
    });
    await waitForChatInitialized(chat);

    expect(chat.pendingToolCalls).toHaveLength(1);
    chat.clearHistory();
    flushSync();

    expect(chat.pendingToolCalls).toEqual([]);
  });

  it("dedupes the same toolCallId across message updates", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const toolPart = {
      type: "tool-foo",
      toolCallId: "call-xyz",
      state: "input-available",
      input: {},
    } as unknown as UIMessage["parts"][number];

    chat.messages = [{ id: "asst-1", role: "assistant", parts: [toolPart] }];
    flushSync();
    await vi.waitFor(() => {
      expect(chat.pendingToolCalls).toHaveLength(1);
    });

    chat.messages = [...chat.messages, { id: "asst-2", role: "assistant", parts: [toolPart] }];
    flushSync();

    await new Promise((r) => setTimeout(r, 100));
    expect(chat.pendingToolCalls).toHaveLength(1);
    expect(chat.pendingToolCalls[0]?.toolCallId).toBe("call-xyz");
  });

  it("toolCall.run sends output, updates local state, and only runs once", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-run", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();

    const handler = vi.fn(async () => ({ temp: 72 }));
    await Promise.all([toolCall!.run(handler), toolCall!.run(handler)]);
    flushSync();

    expect(handler).toHaveBeenCalledTimes(1);
    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toMatchObject({
      toolCallId: "call-run",
      toolName: "getWeather",
      output: { temp: 72 },
      autoContinue: true,
    });

    const toolPart = chat.messages[0]?.parts[0] as {
      state?: string;
      output?: unknown;
    };
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toEqual({ temp: 72 });
    expect(chat.pendingToolCalls).toEqual([]);
  });

  it("toolCall.run no-ops after manual addOutput", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-manual-first", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();

    toolCall!.addOutput({ output: { temp: 72 } });
    await toolCall!.run(() => ({ temp: 73 }));
    flushSync();

    const sent = findSentAll(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.output).toEqual({ temp: 72 });
  });

  it("toolCall.run turns thrown errors into output-error results", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-error", "getWeather")],
    });
    await waitForChatInitialized(chat);

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();

    await toolCall!.run(() => {
      throw new Error("permission denied");
    });
    flushSync();

    expect(toolCall!.handled).toBe(true);
    expect(toolCall!.running).toBe(false);
    expect(toolCall!.lastError?.message).toBe("permission denied");
    expect(chat.pendingToolCalls).toEqual([]);

    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent).toMatchObject({
      toolCallId: "call-error",
      toolName: "getWeather",
      state: "output-error",
      errorText: "permission denied",
      autoContinue: false,
    });
  });

  it("toolCall.run snapshots input before the async handler runs", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.messages = [
      {
        id: "asst-snapshot",
        role: "assistant",
        parts: [
          {
            type: "tool-getWeather",
            toolCallId: "call-snapshot",
            state: "input-available",
            input: { city: "SF" },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ];
    flushSync();

    const toolCall = chat.pendingToolCalls[0];
    expect(toolCall).toBeDefined();

    const run = toolCall!.run(async (input) => input);
    chat.messages = [
      {
        id: "asst-snapshot",
        role: "assistant",
        parts: [
          {
            type: "tool-getWeather",
            toolCallId: "call-snapshot",
            state: "input-available",
            input: { city: "NYC" },
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ];
    flushSync();

    await run;
    const sent = findSent(mock, MessageType.CF_AGENT_TOOL_RESULT);
    expect(sent?.output).toEqual({ city: "SF" });
  });
});

describe("createAgentChat — stream errors", () => {
  it("surfaces terminal errors delivered through the resume handshake", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "resume-error",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "resume-error",
      body: "recovery exhausted",
      error: true,
      done: true,
    });

    await vi.waitFor(() => {
      expect(chat.error?.message).toBe("recovery exhausted");
    });
    expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK)).toMatchObject({
      id: "resume-error",
    });
  });

  it("rejects a local stream on error frames and ignores later chunks", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const request = chat.sendMessage({ text: "hello" });

    let requestId = "";
    await vi.waitFor(() => {
      requestId = String(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)?.id ?? "");
      expect(requestId).not.toBe("");
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: "boom",
      error: true,
      done: true,
    });

    await request;

    expect(chat.error?.message).toBe("boom");

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"start","messageId":"late-after-error"}',
      done: false,
    });
    flushSync();

    expect(chat.messages.some((message) => message.id === "late-after-error")).toBe(false);
  });
});

describe("createAgentChat — lifetime cleanup", () => {
  it("close ignores late server messages", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    chat.close();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: [
        {
          id: "late",
          role: "assistant",
          parts: [{ type: "text", text: "late" }],
        },
      ],
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "late-stream",
    });
    flushSync();

    expect(chat.messages).toEqual([]);
    expect(chat.isServerStreaming).toBe(false);
    expect(chat.isStreaming).toBe(false);
  });

  it("close ignores a later tool-continuation stream announcement", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("call-close-continuation", "getWeather")],
    });
    await waitForChatInitialized(chat);

    chat.pendingToolCalls[0]!.addOutput({ output: { temp: 72 } });
    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    chat.close();
    const ackCountBeforeLateMessages = findSentAll(
      mock,
      MessageType.CF_AGENT_STREAM_RESUME_ACK,
    ).length;

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "late-continuation",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "late-continuation",
      body: '{"type":"start","messageId":"late-continuation-assistant"}',
      done: false,
    });
    flushSync();

    expect(findSentAll(mock, MessageType.CF_AGENT_STREAM_RESUME_ACK)).toHaveLength(
      ackCountBeforeLateMessages,
    );
    expect(chat.messages.some((message) => message.id === "late-continuation-assistant")).toBe(
      false,
    );
  });
});

describe("createAgentChat — stream chunk repair", () => {
  it("synthesizes reasoning-start when a direct stream receives reasoning-delta first", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "think" });

    let requestId = "";
    await vi.waitFor(() => {
      requestId = String(findSent(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST)?.id ?? "");
      expect(requestId).not.toBe("");
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"start","messageId":"assistant-reasoning"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"reasoning-delta","id":"reason-1","delta":"Thinking"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: '{"type":"reasoning-end","id":"reason-1"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: requestId,
      body: "",
      done: true,
    });

    await vi.waitFor(() => {
      const assistant = chat.messages.find((message) => message.id === "assistant-reasoning");
      expect(assistant?.parts).toEqual([
        {
          type: "reasoning",
          text: "Thinking",
          state: "done",
        },
      ]);
    });
  });

  it("preserves approved tool continuation parts when a server sync arrives mid-stream", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      resume: true,
      initialMessages: weatherApprovalInitialMessages(),
    });
    await waitForChatInitialized(chat);

    chat.addToolApprovalResponse({
      id: weatherApprovalFlow.approvalId,
      approved: true,
    });
    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_TOOL_APPROVAL)).toMatchObject({
        toolCallId: weatherApprovalFlow.toolCallId,
        approved: true,
        autoContinue: true,
      });
      expect(findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)).toBeDefined();
    });

    dispatchWeatherApprovalContinuationStart(mock);
    dispatchStaleWeatherApprovalSync(mock);
    dispatchWeatherApprovalContinuationFinish(mock);

    await vi.waitFor(() => {
      const assistant = chat.messages.find(
        (message) => message.id === weatherApprovalFlow.assistantId,
      );
      expect(assistant?.parts).toEqual(expectedWeatherApprovalFinalParts());
    });
  });

  it("starts a new reasoning part when a continuation stream receives reasoning-delta first", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      resume: true,
      initialMessages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "weather in LA" }],
        },
        {
          id: "assistant-approval",
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: "Initial reasoning",
              state: "done",
            },
            {
              type: "tool-getWeatherInformation",
              toolCallId: "call-weather",
              state: "approval-responded",
              input: { city: "Los Angeles" },
              output: "The weather in Los Angeles is sunny, 72°F.",
              approval: { id: "approval-weather", approved: true },
            } as never,
          ],
        },
      ],
    });
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "approval-continuation",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "approval-continuation",
      body: '{"type":"reasoning-delta","id":"reason-2","delta":"Final reasoning"}',
      done: false,
      continuation: true,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "approval-continuation",
      body: '{"type":"reasoning-end","id":"reason-2"}',
      done: false,
      continuation: true,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "approval-continuation",
      body: '{"type":"text-delta","id":"text-2","delta":"Here is the approved weather."}',
      done: false,
      continuation: true,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "approval-continuation",
      body: "",
      done: true,
      continuation: true,
    });

    await vi.waitFor(() => {
      const assistant = chat.messages.find((message) => message.id === "assistant-approval");
      expect(assistant?.parts.filter((part) => part.type === "reasoning")).toEqual([
        { type: "reasoning", text: "Initial reasoning", state: "done" },
        { type: "reasoning", text: "Final reasoning", state: "done" },
      ]);
      expect(assistant?.parts.find((part) => part.type === "text")).toMatchObject({
        text: "Here is the approved weather.",
      });
    });
  });
});

describe("createAgentChat — activity state", () => {
  it("marks the submitted window busy before streaming starts", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "hello" }).catch(() => {});

    await vi.waitFor(() => {
      expect(chat.activity).toEqual({ kind: "submitted" });
    });
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(false);
  });

  it("activity and isStreaming reflect chat.status OR server stream", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, { resume: true });
    await waitForChatInitialized(chat);

    expect(chat.activity).toEqual({ kind: "idle" });
    expect(chat.isBusy).toBe(false);
    expect(chat.isStreaming).toBe(false);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUME_NONE,
    });
    flushSync();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_STREAM_RESUMING,
      id: "stream-1",
    });
    flushSync();

    expect(chat.isServerStreaming).toBe(true);
    expect(chat.activity).toEqual({ kind: "streaming", source: "server", streamIds: ["stream-1"] });
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(true);
  });

  it("keeps recovery busy but separate from streaming", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: true,
      id: "recover-1",
    });
    flushSync();

    expect(chat.isRecovering).toBe(true);
    expect(chat.activity).toEqual({
      kind: "recovering",
      streamIds: ["recover-1"],
      unidentified: false,
    });
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(false);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: false,
    });
    flushSync();

    expect(chat.isRecovering).toBe(false);
    expect(chat.activity).toEqual({ kind: "idle" });
    expect(chat.isBusy).toBe(false);
    expect(chat.isStreaming).toBe(false);
  });

  it("clears recovery state on terminal stream frames and history resets", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: true,
      id: "recover-done",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "recover-done",
      body: "",
      done: true,
    });
    flushSync();

    expect(chat.isRecovering).toBe(false);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: true,
    });
    flushSync();
    expect(chat.isRecovering).toBe(true);

    chat.clearHistory();
    flushSync();

    expect(chat.isRecovering).toBe(false);
    expect(chat.isStreaming).toBe(false);
  });

  it("keeps identified recovery active when an unrelated stream finishes", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: true,
      id: "recover-a",
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: "other-stream",
      body: "",
      done: true,
    });
    flushSync();

    expect(chat.isRecovering).toBe(true);
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(false);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_RECOVERING,
      recovering: false,
      id: "recover-a",
    });
    flushSync();

    expect(chat.isRecovering).toBe(false);
    expect(chat.isStreaming).toBe(false);
  });

  it("isStreaming covers running client tools and tool continuations", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      initialMessages: [seedToolPart("pending-streaming", "get-weather")],
    });
    await waitForChatInitialized(chat);

    expect(chat.pendingToolCalls).toHaveLength(1);
    expect(chat.activity).toMatchObject({ kind: "awaiting-tools" });
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(false);

    let resolveWeather!: (value: { weather: string }) => void;
    const weather = new Promise<{ weather: string }>((resolve) => {
      resolveWeather = resolve;
    });
    const run = chat.pendingToolCalls[0]!.run(() => weather);
    flushSync();

    expect(chat.pendingToolCalls[0]!.running).toBe(true);
    expect(chat.isStreaming).toBe(true);

    resolveWeather({ weather: "sunny" });
    await run;
    flushSync();

    expect(chat.isToolContinuation).toBe(true);
    expect(chat.isBusy).toBe(true);
    expect(chat.isStreaming).toBe(true);

    mock.dispatchServerMessage({ type: MessageType.CF_AGENT_STREAM_RESUME_NONE });
    await vi.waitFor(() => {
      expect(chat.isToolContinuation).toBe(false);
    });
  });
});

describe("createAgentChat — overlapping submits parity", () => {
  it("keeps one assistant message when a second submit arrives mid-stream", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    const firstRequest = chat.sendMessage({ text: "First" });
    let requestIds: string[] = [];
    await vi.waitFor(() => {
      requestIds = findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST).map((message) =>
        String(message.id),
      );
      expect(requestIds).toHaveLength(1);
    });

    const firstRequestId = requestIds[0]!;
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"start","messageId":"assistant-1"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"text-start","id":"text-1"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"text-delta","id":"text-1","delta":"Hello"}',
      done: false,
    });

    await vi.waitFor(() => {
      expect(chat.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
      expect(chat.messages.map((message) => message.role).join(",")).toBe("user,assistant");
    });

    const secondRequest = chat.sendMessage({ text: "Second" });
    await vi.waitFor(() => {
      requestIds = findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST).map((message) =>
        String(message.id),
      );
      expect(requestIds).toHaveLength(2);
    });

    const secondRequestId = requestIds[1]!;
    const [firstUserMessage, secondUserMessage] = chat.messages.filter(
      (message) => message.role === "user",
    );
    const protectedAssistant = chat.messages.find((message) => message.id === "assistant-1");

    expect(firstUserMessage).toBeDefined();
    expect(secondUserMessage).toBeDefined();
    expect(protectedAssistant).toBeDefined();

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: [firstUserMessage, protectedAssistant, secondUserMessage],
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"text-delta","id":"text-1","delta":" there"}',
      done: false,
    });

    await vi.waitFor(() => {
      const assistantMessages = chat.messages.filter((message) => message.role === "assistant");
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.id).toBe("assistant-1");
      const textPart = assistantMessages[0]?.parts.find((part) => part.type === "text") as
        | { text?: string }
        | undefined;
      expect(textPart?.text).toBe("Hello there");
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: "",
      done: true,
    });
    await firstRequest;

    await vi.waitFor(() => {
      expect(chat.messages.map((message) => message.role).join(",")).toBe("user,assistant,user");
    });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: secondRequestId,
      body: '{"type":"start","messageId":"assistant-2"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: secondRequestId,
      body: '{"type":"text-start","id":"text-2"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: secondRequestId,
      body: '{"type":"text-delta","id":"text-2","delta":"Follow-up"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: secondRequestId,
      body: "",
      done: true,
    });
    await secondRequest;

    await vi.waitFor(() => {
      expect(chat.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
      expect(chat.messages.map((message) => message.role).join(",")).toBe(
        "user,assistant,user,assistant",
      );
    });
  });

  it("does not release a protected assistant for streams without a start message", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "First" });
    let requestIds: string[] = [];
    await vi.waitFor(() => {
      requestIds = findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST).map((message) =>
        String(message.id),
      );
      expect(requestIds).toHaveLength(1);
    });

    const firstRequestId = requestIds[0]!;
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"start","messageId":"assistant-1"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"text-start","id":"text-1"}',
      done: false,
    });
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: firstRequestId,
      body: '{"type":"text-delta","id":"text-1","delta":"Hello"}',
      done: false,
    });

    await vi.waitFor(() => {
      expect(chat.messages.some((message) => message.id === "assistant-1")).toBe(true);
    });

    void chat.sendMessage({ text: "Second" });
    await vi.waitFor(() => {
      requestIds = findSentAll(mock, MessageType.CF_AGENT_USE_CHAT_REQUEST).map((message) =>
        String(message.id),
      );
      expect(requestIds).toHaveLength(2);
    });

    const secondRequestId = requestIds[1]!;
    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      id: secondRequestId,
      body: "",
      done: true,
    });

    const userMessages = chat.messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: userMessages,
    });

    await vi.waitFor(() => {
      expect(chat.messages.some((message) => message.id === "assistant-1")).toBe(true);
    });
  });

  it("does not activate protection when not streaming", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock);
    await waitForChatInitialized(chat);

    void chat.sendMessage({ text: "First" });
    void chat.sendMessage({ text: "Second" });

    mock.dispatchServerMessage({
      type: MessageType.CF_AGENT_CHAT_MESSAGES,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "First" }],
        },
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Second" }],
        },
      ],
    });

    await vi.waitFor(() => {
      expect(chat.messages).toHaveLength(2);
      expect(chat.messages.map((message) => message.role).join(",")).toBe("user,user");
    });
  });
});
