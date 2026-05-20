/**
 * ChatTransport implementation for Cloudflare Agents chat over the Agent
 * WebSocket protocol. Owns socket demux, active stream sessions, resume
 * handshakes, and semantic events consumed by AgentChat.
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { nanoid } from "nanoid";
import { MessageType, type OutgoingMessage } from "@cloudflare/ai-chat/types";

interface AgentChatConnection {
  send: (data: string) => void;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
}

type PrepareBody<ChatMessage extends UIMessage> = (options: {
  messages: ChatMessage[];
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
}) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type AgentChatTransportEvent<ChatMessage extends UIMessage = UIMessage> =
  | { type: "history-cleared" }
  | { type: "messages-replaced"; messages: ChatMessage[] }
  | { type: "message-updated"; message: ChatMessage }
  | { type: "broadcast-resume"; streamId: string }
  | { type: "replay-hydrated-reset"; messageId: string }
  | {
      type: "broadcast-response";
      streamId: string;
      chunkData: unknown;
      done?: boolean;
      error?: boolean;
      replay?: boolean;
      replayComplete?: boolean;
      continuation?: boolean;
    }
  | {
      type: "assistant-tail-released";
      messageId?: string;
    };

type AgentChatTransportOptions<ChatMessage extends UIMessage = UIMessage> = {
  getConnection: () => AgentChatConnection | null;
  prepareBody?: PrepareBody<ChatMessage>;
  cancelOnClientAbort?: boolean;
};

type AgentChatTransportStartOptions<ChatMessage extends UIMessage = UIMessage> = {
  onEvent: (event: AgentChatTransportEvent<ChatMessage>) => void;
  shouldAcceptBroadcastResume: () => boolean;
};

type ActiveStreamSession = {
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  activeTextIds: Set<string>;
  activeReasoningIds: Set<string>;
  finish: (
    action: () => void,
    options?: { ignoreRemaining?: boolean; emitLocalFinish?: boolean },
  ) => void;
};

type PendingResume = {
  accept: (requestId: string) => void;
  none: () => void;
  cancel: () => void;
};

type ChatResponseMessage<ChatMessage extends UIMessage> = Extract<
  OutgoingMessage<ChatMessage>,
  { type: MessageType.CF_AGENT_USE_CHAT_RESPONSE }
>;

type StreamResumingMessage<ChatMessage extends UIMessage> = Extract<
  OutgoingMessage<ChatMessage>,
  { type: MessageType.CF_AGENT_STREAM_RESUMING }
>;

export class AgentChatTransport<
  ChatMessage extends UIMessage = UIMessage,
> implements ChatTransport<ChatMessage> {
  readonly #getConnection: () => AgentChatConnection | null;
  #startedConnection: AgentChatConnection | null = null;
  readonly #prepareBody?: PrepareBody<ChatMessage>;
  #cancelOnClientAbort: boolean;
  #onEvent: ((event: AgentChatTransportEvent<ChatMessage>) => void) | null = null;
  #shouldAcceptBroadcastResume: (() => boolean) | null = null;
  readonly #activeStreams = new Map<string, ActiveStreamSession>();
  readonly #ignoredRequestIds = new Set<string>();
  readonly #assistantMessageIds = new Map<string, string>();
  readonly #pendingReplayStreamIds = new Set<string>();

  #pendingResume: PendingResume | null = null;
  #expectToolContinuation = false;
  #abortActiveContinuation: ((cancelServer: boolean) => boolean) | null = null;
  #started = false;
  #closed = false;

  constructor(options: AgentChatTransportOptions<ChatMessage>) {
    this.#getConnection = options.getConnection;
    this.#prepareBody = options.prepareBody;
    this.#cancelOnClientAbort = options.cancelOnClientAbort ?? false;
  }

  start(options: AgentChatTransportStartOptions<ChatMessage>): void {
    if (this.#started || this.#closed) {
      return;
    }

    this.#onEvent = options.onEvent;
    this.#shouldAcceptBroadcastResume = options.shouldAcceptBroadcastResume;
    this.#started = true;
    this.syncConnection();
  }

  syncConnection(): void {
    if (!this.#started || this.#closed) {
      return;
    }

    const connection = this.#getConnection();
    if (connection === this.#startedConnection) {
      return;
    }

    this.#startedConnection?.removeEventListener("message", this.#handleMessage);
    this.#startedConnection = connection;
    connection?.addEventListener("message", this.#handleMessage);
  }

  prepareToolContinuation(): void {
    this.#expectToolContinuation = true;
  }

  setCancelOnClientAbort(cancelOnClientAbort: boolean): void {
    this.#cancelOnClientAbort = cancelOnClientAbort;
  }

  abortActiveContinuation(options: { cancelServer?: boolean } = {}): boolean {
    return this.#abortActiveContinuation?.(options.cancelServer ?? true) ?? false;
  }

  sendMessagesSnapshot(messages: ChatMessage[]): void {
    this.#send({ type: MessageType.CF_AGENT_CHAT_MESSAGES, messages });
  }

  clearHistory(): void {
    this.cancelActiveStreams();
    this.#send({ type: MessageType.CF_AGENT_CHAT_CLEAR });
  }

  cancelActiveStreams(): void {
    this.#pendingResume?.cancel();
    this.#pendingResume = null;
    this.#abortActiveContinuation = null;
    this.#pendingReplayStreamIds.clear();

    for (const [requestId, session] of this.#activeStreams) {
      try {
        this.#send({
          id: requestId,
          type: MessageType.CF_AGENT_CHAT_REQUEST_CANCEL,
        });
      } catch {
        // Ignore failures, e.g. if the connection is already closed.
      }
      session.finish(() => session.controller.close(), {
        ignoreRemaining: true,
        emitLocalFinish: false,
      });
    }
  }

  sendToolResult(options: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    state?: "output-available" | "output-error";
    errorText?: string;
    autoContinue: boolean;
    clientTools?: unknown;
  }): void {
    this.#send({
      type: MessageType.CF_AGENT_TOOL_RESULT,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      output: options.output,
      ...(options.state ? { state: options.state } : {}),
      ...(options.errorText !== undefined ? { errorText: options.errorText } : {}),
      autoContinue: options.autoContinue,
      ...(options.clientTools ? { clientTools: options.clientTools } : {}),
    });
  }

  sendToolApproval(options: {
    toolCallId: string;
    approved: boolean;
    autoContinue: boolean;
  }): void {
    this.#send({
      type: MessageType.CF_AGENT_TOOL_APPROVAL,
      toolCallId: options.toolCallId,
      approved: options.approved,
      autoContinue: options.autoContinue,
    });
  }

  async sendMessages(options: {
    chatId: string;
    messages: ChatMessage[];
    abortSignal: AbortSignal | undefined;
    trigger: "submit-message" | "regenerate-message";
    messageId?: string;
    body?: object;
    headers?: Record<string, string> | Headers;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const requestId = nanoid(8);
    let completed = false;
    let session: ActiveStreamSession | null = null;

    let extraBody: Record<string, unknown> = {};
    if (this.#prepareBody) {
      extraBody = await this.#prepareBody({
        messages: options.messages,
        trigger: options.trigger,
        messageId: options.messageId,
      });
    }
    if (options.body) {
      extraBody = {
        ...extraBody,
        ...(options.body as Record<string, unknown>),
      };
    }

    const bodyPayload = JSON.stringify({
      messages: options.messages,
      trigger: options.trigger,
      ...extraBody,
    });

    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    const onAbort = () => {
      if (completed) return;
      if (this.#cancelOnClientAbort) {
        try {
          this.#send({
            id: requestId,
            type: MessageType.CF_AGENT_CHAT_REQUEST_CANCEL,
          });
        } catch {
          // Ignore failures, e.g. if the connection is already closed.
        }
      }
      session?.finish(() => session?.controller.error(abortError), {
        ignoreRemaining: true,
        emitLocalFinish: false,
      });
    };

    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        session = this.#registerStream(requestId, controller, () => {
          completed = true;
        });
      },
      cancel: () => {
        onAbort();
      },
    });

    this.#send({
      id: requestId,
      init: {
        method: "POST",
        body: bodyPayload,
      },
      type: MessageType.CF_AGENT_USE_CHAT_REQUEST,
    });

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", onAbort, { once: true });
      if (options.abortSignal.aborted) onAbort();
    }

    return stream;
  }

  async reconnectToStream(_options: {
    chatId: string;
  }): Promise<ReadableStream<UIMessageChunk> | null> {
    if (this.#expectToolContinuation) {
      this.#expectToolContinuation = false;
      return this.#createToolContinuationStream();
    }

    return new Promise<ReadableStream<UIMessageChunk> | null>((resolve) => {
      let resolved = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const done = (value: ReadableStream<UIMessageChunk> | null) => {
        if (resolved) return;
        resolved = true;
        if (this.#pendingResume === pending) {
          this.#pendingResume = null;
        }
        if (timeout) clearTimeout(timeout);
        resolve(value);
      };

      const pending: PendingResume = {
        accept: (requestId) => {
          this.#sendResumeAck(requestId);
          done(this.#createResumeStream(requestId));
        },
        none: () => done(null),
        cancel: () => done(null),
      };

      this.#pendingResume?.cancel();
      this.#pendingResume = pending;
      this.#sendResumeRequest();
      timeout = setTimeout(() => done(null), 5000);
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    if (this.#started) {
      this.#startedConnection?.removeEventListener("message", this.#handleMessage);
      this.#started = false;
      this.#startedConnection = null;
    }
    this.#pendingResume?.cancel();
    this.#pendingResume = null;
    this.#abortActiveContinuation?.(false);
    for (const session of this.#activeStreams.values()) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      session.finish(() => session.controller.error(abortError), {
        emitLocalFinish: false,
      });
    }
    this.#activeStreams.clear();
    this.#ignoredRequestIds.clear();
    this.#assistantMessageIds.clear();
    this.#pendingReplayStreamIds.clear();
  }

  #createToolContinuationStream(): ReadableStream<UIMessageChunk> {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    let completed = false;
    let requestId: string | null = null;
    let session: ActiveStreamSession | null = null;
    let readerController!: ReadableStreamDefaultController<UIMessageChunk>;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const clearPending = (pending: PendingResume) => {
      if (this.#pendingResume === pending) {
        this.#pendingResume = null;
      }
      if (timeout) clearTimeout(timeout);
    };

    const finish = (
      action: () => void,
      pending?: PendingResume,
      options?: { ignoreRemaining?: boolean },
    ) => {
      if (completed) return;
      completed = true;
      this.#abortActiveContinuation = null;
      if (pending) clearPending(pending);
      if (requestId && session) {
        session.finish(action, {
          ignoreRemaining: options?.ignoreRemaining,
          emitLocalFinish: true,
        });
      } else {
        try {
          action();
        } catch {
          // Stream may already be closed.
        }
      }
    };

    this.#abortActiveContinuation = (cancelServer) => {
      if (completed) {
        return false;
      }

      if (cancelServer && requestId) {
        try {
          this.#send({
            type: MessageType.CF_AGENT_CHAT_REQUEST_CANCEL,
            id: requestId,
          });
        } catch {
          // Ignore failures, e.g. if the connection is already closed.
        }
      }

      finish(() => readerController.error(abortError), this.#pendingResume ?? undefined, {
        ignoreRemaining: requestId !== null,
      });
      return true;
    };

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        readerController = controller;

        const pending: PendingResume = {
          accept: (id) => {
            if (completed || requestId) return;
            requestId = id;
            clearPending(pending);
            session = this.#registerStream(id, controller, () => {
              completed = true;
              this.#abortActiveContinuation = null;
            });
            this.#sendResumeAck(id);
          },
          none: () => {
            finish(() => controller.close(), pending);
          },
          cancel: () => {
            finish(() => controller.close(), pending);
          },
        };

        this.#pendingResume?.cancel();
        this.#pendingResume = pending;
        this.#sendResumeRequest();
        timeout = setTimeout(() => finish(() => controller.close(), pending), 5000);
      },
      cancel: () => {
        finish(() => {});
      },
    });
  }

  #createResumeStream(requestId: string): ReadableStream<UIMessageChunk> {
    let session: ActiveStreamSession | null = null;

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        session = this.#registerStream(requestId, controller);
      },
      cancel: () => {
        session?.finish(() => {}, { emitLocalFinish: false });
      },
    });
  }

  #registerStream(
    requestId: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    onFinish?: () => void,
  ): ActiveStreamSession {
    let completed = false;
    const session: ActiveStreamSession = {
      controller,
      activeTextIds: new Set(),
      activeReasoningIds: new Set(),
      finish: (action, options) => {
        if (completed) return;
        completed = true;
        try {
          action();
        } catch {
          // Stream may already be closed.
        }
        this.#activeStreams.delete(requestId);
        if (options?.ignoreRemaining) {
          this.#ignoredRequestIds.add(requestId);
        }
        if (options?.emitLocalFinish !== false) {
          this.#releaseAssistantTail(requestId);
        }
        onFinish?.();
      },
    };

    this.#activeStreams.set(requestId, session);
    return session;
  }

  #handleMessage = (event: MessageEvent) => {
    if (this.#closed || typeof event.data !== "string") {
      return;
    }

    let data: OutgoingMessage<ChatMessage>;
    try {
      data = JSON.parse(event.data) as OutgoingMessage<ChatMessage>;
    } catch {
      return;
    }

    switch (data.type) {
      case MessageType.CF_AGENT_CHAT_CLEAR:
        this.#onEvent?.({ type: "history-cleared" });
        break;

      case MessageType.CF_AGENT_CHAT_MESSAGES:
        this.#onEvent?.({
          type: "messages-replaced",
          messages: data.messages as ChatMessage[],
        });
        break;

      case MessageType.CF_AGENT_MESSAGE_UPDATED:
        this.#onEvent?.({
          type: "message-updated",
          message: data.message as ChatMessage,
        });
        break;

      case MessageType.CF_AGENT_STREAM_RESUME_NONE:
        this.#pendingResume?.none();
        break;

      case MessageType.CF_AGENT_STREAM_RESUMING:
        this.#handleStreamResuming(data as StreamResumingMessage<ChatMessage>);
        break;

      case MessageType.CF_AGENT_USE_CHAT_RESPONSE:
        this.#handleChatResponse(data as ChatResponseMessage<ChatMessage>);
        break;
    }
  };

  #handleStreamResuming(data: StreamResumingMessage<ChatMessage>): void {
    const requestId = data.id;

    if (this.#pendingResume) {
      this.#pendingReplayStreamIds.add(requestId);
      this.#pendingResume.accept(requestId);
      return;
    }

    if (this.#activeStreams.has(requestId)) {
      return;
    }

    if (!this.#shouldAcceptBroadcastResume?.()) {
      return;
    }

    this.#pendingReplayStreamIds.add(requestId);
    this.#sendResumeAck(requestId);
    this.#onEvent?.({ type: "broadcast-resume", streamId: requestId });
  }

  #handleChatResponse(data: ChatResponseMessage<ChatMessage>): void {
    const requestId = data.id;
    const chunkData = this.#parseChunk(data.body);
    if (chunkData !== undefined) {
      this.#rememberLocalMessageId(requestId, chunkData);
      this.#maybeEmitReplayHydratedReset(requestId, data.replay, chunkData);
    }

    if (data.done || data.error || data.replayComplete) {
      this.#pendingReplayStreamIds.delete(requestId);
    }

    const session = this.#activeStreams.get(requestId);
    if (session) {
      if (data.error) {
        session.finish(() => session.controller.error(new Error(data.body || "Stream error")), {
          ignoreRemaining: true,
          emitLocalFinish: true,
        });
        return;
      }

      if (chunkData !== undefined) {
        this.#enqueueChunk(session, chunkData);
      }

      if (data.done) {
        session.finish(() => session.controller.close(), {
          emitLocalFinish: true,
        });
      }
      return;
    }

    if (this.#ignoredRequestIds.has(requestId)) {
      if (data.done || data.error) {
        this.#ignoredRequestIds.delete(requestId);
        this.#releaseAssistantTail(requestId);
      }
      return;
    }

    this.#onEvent?.({
      type: "broadcast-response",
      streamId: requestId,
      chunkData,
      done: data.done,
      error: data.error,
      replay: data.replay,
      replayComplete: data.replayComplete,
      continuation: data.continuation,
    });
  }

  #enqueueChunk(session: ActiveStreamSession, chunk: UIMessageChunk): void {
    try {
      // Keep the direct ChatTransport stream as tolerant as agents/chat's
      // message-builder fallback: resumed and continuation streams can miss a
      // text-start/reasoning-start chunk while still delivering deltas/ends.
      if (this.#isTextStart(chunk)) {
        session.activeTextIds.add(chunk.id);
      } else if (this.#isTextDelta(chunk) || this.#isTextEnd(chunk)) {
        if (!session.activeTextIds.has(chunk.id)) {
          session.activeTextIds.add(chunk.id);
          session.controller.enqueue({ type: "text-start", id: chunk.id });
        }
        if (this.#isTextEnd(chunk)) {
          session.activeTextIds.delete(chunk.id);
        }
      }

      if (this.#isReasoningStart(chunk)) {
        session.activeReasoningIds.add(chunk.id);
      } else if (this.#isReasoningDelta(chunk) || this.#isReasoningEnd(chunk)) {
        if (!session.activeReasoningIds.has(chunk.id)) {
          session.activeReasoningIds.add(chunk.id);
          session.controller.enqueue({ type: "reasoning-start", id: chunk.id });
        }
        if (this.#isReasoningEnd(chunk)) {
          session.activeReasoningIds.delete(chunk.id);
        }
      }

      session.controller.enqueue(chunk);
    } catch {
      // Stream may already be closed.
    }
  }

  #isTextStart(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "text-start" && "id" in chunk && typeof chunk.id === "string";
  }

  #isTextDelta(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "text-delta" && "id" in chunk && typeof chunk.id === "string";
  }

  #isTextEnd(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "text-end" && "id" in chunk && typeof chunk.id === "string";
  }

  #isReasoningStart(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "reasoning-start" && "id" in chunk && typeof chunk.id === "string";
  }

  #isReasoningDelta(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "reasoning-delta" && "id" in chunk && typeof chunk.id === "string";
  }

  #isReasoningEnd(chunk: UIMessageChunk): chunk is UIMessageChunk & { id: string } {
    return chunk.type === "reasoning-end" && "id" in chunk && typeof chunk.id === "string";
  }

  #maybeEmitReplayHydratedReset(
    requestId: string,
    replay: boolean | undefined,
    chunkData: unknown,
  ): void {
    if (
      !replay ||
      !this.#pendingReplayStreamIds.has(requestId) ||
      typeof chunkData !== "object" ||
      chunkData === null ||
      !("type" in chunkData) ||
      chunkData.type !== "start" ||
      !("messageId" in chunkData) ||
      typeof chunkData.messageId !== "string"
    ) {
      return;
    }

    this.#pendingReplayStreamIds.delete(requestId);
    this.#onEvent?.({ type: "replay-hydrated-reset", messageId: chunkData.messageId });
  }

  #rememberLocalMessageId(requestId: string, chunkData: unknown): void {
    if (
      typeof chunkData !== "object" ||
      chunkData === null ||
      !("type" in chunkData) ||
      chunkData.type !== "start" ||
      !("messageId" in chunkData) ||
      typeof chunkData.messageId !== "string"
    ) {
      return;
    }

    this.#assistantMessageIds.set(requestId, chunkData.messageId);
  }

  #releaseAssistantTail(requestId: string): void {
    const messageId = this.#assistantMessageIds.get(requestId);
    this.#assistantMessageIds.delete(requestId);
    this.#onEvent?.({
      type: "assistant-tail-released",
      ...(messageId ? { messageId } : {}),
    });
  }

  #parseChunk(body: string | undefined): UIMessageChunk | undefined {
    if (!body?.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(body) as UIMessageChunk;
    } catch {
      return undefined;
    }
  }

  #sendResumeRequest(): void {
    try {
      this.#send({ type: MessageType.CF_AGENT_STREAM_RESUME_REQUEST });
    } catch {
      // WebSocket may already be closed.
    }
  }

  #sendResumeAck(id: string): void {
    this.#send({ type: MessageType.CF_AGENT_STREAM_RESUME_ACK, id });
  }

  #send(payload: Record<string, unknown>): void {
    const connection = this.#getConnection();
    if (!connection) {
      throw new Error("[agents-svelte/chat] AgentChatTransport is not connected");
    }
    connection.send(JSON.stringify(payload));
  }
}
