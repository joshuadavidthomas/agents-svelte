import { onDestroy } from "svelte";
import { Chat } from "@ai-sdk/svelte";
import {
  AgentChatTransport,
  type AgentChatTransportEvent
} from "./chat-transport.ts";
import { broadcastTransition, type BroadcastStreamState } from "agents/chat";
import { isToolUIPart, getToolName, type ChatInit, type UIMessage } from "ai";
import { nanoid } from "nanoid";
import type { Agent } from "./agent.svelte.ts";
import { camelCaseToKebabCase } from "./utils.ts";

export type { ClientToolSchema } from "agents/chat";

export type ToolCallOutputOptions =
  | {
      state?: "output-available";
      output?: unknown;
      errorText?: never;
    }
  | {
      state: "output-error";
      errorText: string;
      output?: never;
    };

type ToolCallOutputSubmission = ToolCallOutputOptions & {
  toolCallId: string;
  messageId: string;
};

export class AgentChatToolCall {
  messageId = $state("");
  input = $state<unknown>(undefined);
  running = $state(false);
  handled = $state(false);
  lastError = $state<Error | null>(null);

  readonly toolCallId: string;
  readonly toolName: string;

  #runPromise: Promise<void> | null = null;
  readonly #addOutput: (opts: ToolCallOutputSubmission) => void;

  constructor(options: {
    toolCallId: string;
    toolName: string;
    messageId: string;
    input: unknown;
    addOutput: (opts: ToolCallOutputSubmission) => void;
  }) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.messageId = options.messageId;
    this.input = options.input;
    this.#addOutput = options.addOutput;
  }

  addOutput(opts: ToolCallOutputOptions = {}): void {
    if (this.handled) {
      return;
    }

    this.handled = true;
    this.running = false;
    this.#addOutput({
      toolCallId: this.toolCallId,
      messageId: this.messageId,
      ...opts
    });
  }

  async run(
    handler: (
      input: unknown,
      toolCall: AgentChatToolCall
    ) => unknown | Promise<unknown>
  ): Promise<void> {
    if (this.handled) {
      return;
    }
    if (this.#runPromise) {
      return this.#runPromise;
    }

    this.running = true;
    this.lastError = null;
    const input = $state.snapshot(this.input);

    this.#runPromise = Promise.resolve()
      .then(() => handler(input, this))
      .then((output) => {
        if (!this.handled) {
          this.addOutput({ output });
        }
      })
      .catch((error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.lastError = normalized;
        if (!this.handled) {
          this.addOutput({
            state: "output-error",
            errorText: normalized.message
          });
        }
      })
      .finally(() => {
        this.running = false;
        this.#runPromise = null;
      });

    return this.#runPromise;
  }
}

export type PrepareSendMessagesRequestOptions<M extends UIMessage = UIMessage> =
  {
    id: string;
    messages: M[];
    trigger: "submit-message" | "regenerate-message";
    messageId?: string;
  };

export type PrepareSendMessagesRequestResult = {
  body?: Record<string, unknown>;
};

export interface CreateAgentChatOptions<
  M extends UIMessage = UIMessage
> extends Omit<ChatInit<M>, "transport" | "onToolCall" | "id" | "messages"> {
  agent: Agent<unknown, unknown>;
  /**
   * Initial messages. If omitted, messages are fetched from
   * `<agent-url>/get-messages`. Pass `null` to disable both.
   */
  getInitialMessages?:
    | null
    | ((options: { agent: string; name: string; url: string }) => Promise<M[]>);
  initialMessages?: M[];
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  body?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  prepareSendMessagesRequest?: (
    options: PrepareSendMessagesRequestOptions<M>
  ) =>
    | PrepareSendMessagesRequestResult
    | Promise<PrepareSendMessagesRequestResult>;
  /**
   * Server auto-continues after tool results/approvals (default true).
   * When false, call `sendMessage()` to continue.
   */
  autoContinueAfterToolResult?: boolean;
  /** Set false to disable automatic stream resumption on connect. */
  resume?: boolean;
}

export async function getAgentMessages<M extends UIMessage = UIMessage>(
  options:
    | {
        host: string;
        agent: string;
        name: string;
        credentials?: RequestCredentials;
        headers?: HeadersInit;
      }
    | {
        url: string;
        credentials?: RequestCredentials;
        headers?: HeadersInit;
      }
): Promise<M[]> {
  let url: string;
  if ("url" in options) {
    url = options.url;
  } else {
    const slug = camelCaseToKebabCase(options.agent);
    const base = options.host.replace(/\/$/, "");
    url = `${base}/agents/${slug}/${options.name}/get-messages`;
  }
  try {
    const r = await fetch(url, {
      credentials: options.credentials,
      headers: options.headers
    });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.trim()) return [];
    return JSON.parse(text) as M[];
  } catch {
    return [];
  }
}

export class AgentChat<M extends UIMessage = UIMessage> extends Chat<M> {
  declare addToolOutput: never;
  declare addToolResult: never;

  initialized = $state(false);
  initialLoadError = $state<Error | null>(null);

  isServerStreaming = $state(false);

  get isStreaming(): boolean {
    return this.status === "streaming" || this.isServerStreaming;
  }

  readonly #transport: AgentChatTransport<M>;
  #pendingToolCalls = $state<AgentChatToolCall[]>([]);

  get pendingToolCalls(): readonly AgentChatToolCall[] {
    return this.#pendingToolCalls;
  }

  readonly #autoContinueAfterToolResult: boolean;
  readonly #sendAutomaticallyWhen?: ChatInit<M>["sendAutomaticallyWhen"];
  readonly #toolCalls = new Map<string, AgentChatToolCall>();
  #protectedStreamingAssistant: {
    assistantId: string;
    anchorMessageId: string | null;
  } | null = null;
  #closed = false;
  #clientContinuationPromise: Promise<void> | null = null;
  #clientContinuationRequested = false;
  #cleanupPendingToolCallsEffect: (() => void) | null = null;
  readonly #streamState: { current: BroadcastStreamState } = {
    current: { status: "idle" } as BroadcastStreamState
  };

  constructor(options: CreateAgentChatOptions<M>) {
    const {
      agent,
      getInitialMessages,
      initialMessages,
      credentials,
      headers,
      body: bodyOption,
      prepareSendMessagesRequest,
      autoContinueAfterToolResult = true,
      sendAutomaticallyWhen,
      resume = true,
      ...chatInit
    } = options;

    const agentUrl = new URL(agent.getHttpUrl());
    agentUrl.searchParams.delete("_pk");
    const agentUrlString = agentUrl.toString();
    const cacheKey = `${agentUrl.origin}${agentUrl.pathname}|${agent.identity.agent}|${agent.identity.name}`;

    const initialPromise: Promise<M[]> =
      getInitialMessages === null
        ? Promise.resolve(initialMessages ?? [])
        : getInitialMessages
          ? getInitialMessages({
              agent: agent.identity.agent,
              name: agent.identity.name,
              url: agentUrlString
            })
          : getAgentMessages<M>({
              url: `${agentUrlString.replace(/\/$/, "")}/get-messages`,
              credentials,
              headers
            });

    const transport = new AgentChatTransport<M>({
      connection: agent.socket,
      prepareBody: async ({ messages: msgs, trigger, messageId }) => {
        let extra: Record<string, unknown> = {};
        if (bodyOption) {
          const resolved =
            typeof bodyOption === "function" ? await bodyOption() : bodyOption;
          extra = { ...resolved };
        }
        if (prepareSendMessagesRequest) {
          const result = await prepareSendMessagesRequest({
            id: cacheKey,
            messages: msgs,
            trigger,
            messageId
          });
          if (result.body) Object.assign(extra, result.body);
        }
        return extra;
      }
    });

    super({
      ...chatInit,
      id: cacheKey,
      transport,
      messages: initialMessages ?? [],
      sendAutomaticallyWhen
    });

    // @ai-sdk/svelte installs these as instance fields in its constructor.
    // `declare ...: never` hides them from TypeScript, but runtime deletion is
    // still needed so AgentChat has one Svelte-shaped tool output surface.
    delete (this as unknown as { addToolOutput?: unknown }).addToolOutput;
    delete (this as unknown as { addToolResult?: unknown }).addToolResult;

    this.#transport = transport;
    transport.start({
      onEvent: (event) => this.#handleTransportEvent(event),
      shouldAcceptBroadcastResume: () => resume && !this.#closed
    });
    this.#autoContinueAfterToolResult = autoContinueAfterToolResult;
    this.#sendAutomaticallyWhen = sendAutomaticallyWhen;

    const baseStop = this.stop.bind(this) as Chat<M>["stop"];
    this.stop = (async () => {
      try {
        await baseStop();
      } finally {
        this.#transport.abortActiveContinuation();
      }
    }) as Chat<M>["stop"];

    const baseSendMessage = this.sendMessage.bind(
      this
    ) as Chat<M>["sendMessage"];
    this.sendMessage = (async (message, requestOptions) => {
      if (this.#closed) {
        return;
      }

      const request = baseSendMessage(message, requestOptions);

      if (
        message !== undefined &&
        !(
          typeof message === "object" &&
          message !== null &&
          "messageId" in message &&
          message.messageId != null
        )
      ) {
        this.#protectStreamingAssistantTail();
      }

      return request;
    }) as Chat<M>["sendMessage"];

    initialPromise
      .then((msgs) => {
        if (this.#closed) {
          return;
        }
        if (msgs.length > 0 && this.messages.length === 0) {
          this.messages = msgs;
        }
        this.initialLoadError = null;
        this.initialized = true;
        if (resume) {
          void this.resumeStream().catch(() => {});
        }
      })
      .catch((e) => {
        if (this.#closed) {
          return;
        }
        this.initialLoadError = e instanceof Error ? e : new Error(String(e));
        this.initialized = true;
      });

    this.#cleanupPendingToolCallsEffect = $effect.root(() => {
      $effect(() => {
        this.#syncPendingToolCalls();
      });
    });
  }

  override addToolApprovalResponse = (opts: {
    id: string;
    approved: boolean;
    reason?: string;
  }): void => {
    if (this.#closed) {
      return;
    }

    let toolCallId: string | undefined;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      for (const p of this.messages[i].parts) {
        if (
          isToolUIPart(p) &&
          p.state === "approval-requested" &&
          p.approval.id === opts.id
        ) {
          toolCallId = p.toolCallId;
          break;
        }
      }
      if (toolCallId) break;
    }
    if (toolCallId) {
      this.#transport.sendToolApproval({
        toolCallId,
        approved: opts.approved,
        autoContinue: this.#autoContinueAfterToolResult
      });
      if (this.#autoContinueAfterToolResult) {
        this.#startToolContinuation();
      }
    } else {
      const knownApproval = this.messages.some((message) =>
        message.parts.some((part) => {
          const approval = (part as { approval?: { id: string } }).approval;
          return approval?.id === opts.id;
        })
      );
      if (!knownApproval) {
        console.warn(
          `[cloudflare-agents-svelte/chat] addToolApprovalResponse: no toolCallId for approval id "${opts.id}". Server will not be notified.`
        );
      }
      return;
    }
    this.#applyToolApprovalLocally(opts);
    void this.#continueFromClientWhenConfigured().catch(() => {});
  };

  setMessages(
    next: M[] | ((prev: M[]) => M[]),
    options?: { skipServerSync?: boolean }
  ): void {
    const resolved = typeof next === "function" ? next(this.messages) : next;
    const messages = this.#preserveProtectedStreamingAssistant(resolved);
    this.messages = messages;
    if (options?.skipServerSync) return;
    this.#transport.sendMessagesSnapshot(messages);
  }

  clearHistory(): void {
    if (this.#closed) {
      return;
    }

    this.messages = [];
    this.#resetLocalTransientState();
    this.#resetStreamState();
    this.#transport.clearHistory();
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    void this.stop().catch(() => {});
    this.#cleanupPendingToolCallsEffect?.();
    this.#cleanupPendingToolCallsEffect = null;
    this.#resetLocalTransientState();
    this.#resetStreamState();
    this.#transport.close();
  }

  #resetLocalTransientState(): void {
    this.#toolCalls.clear();
    this.#pendingToolCalls = [];
    this.#protectedStreamingAssistant = null;
  }

  #startToolContinuation(): void {
    if (this.#closed) {
      return;
    }

    this.#transport.prepareToolContinuation();
    void this.resumeStream().catch(() => {});
  }

  #resetStreamState(): void {
    this.#streamState.current = { status: "idle" } as BroadcastStreamState;
    this.isServerStreaming = false;
  }

  #continueFromClientWhenConfigured(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    this.#clientContinuationRequested = true;
    if (!this.#clientContinuationPromise) {
      this.#clientContinuationPromise =
        this.#drainClientContinuationRequests().finally(() => {
          this.#clientContinuationPromise = null;
          // A request can arrive after the drain loop's final check but before
          // this promise clears. Re-enter so that request is not stranded.
          if (this.#clientContinuationRequested) {
            void this.#continueFromClientWhenConfigured().catch(() => {});
          }
        });
    }

    return this.#clientContinuationPromise;
  }

  async #drainClientContinuationRequests(): Promise<void> {
    while (this.#clientContinuationRequested) {
      this.#clientContinuationRequested = false;
      await this.#continueFromClientWhenConfiguredOnce();
    }
  }

  async #continueFromClientWhenConfiguredOnce(): Promise<void> {
    if (
      this.#closed ||
      this.#autoContinueAfterToolResult ||
      !this.#sendAutomaticallyWhen ||
      this.status === "streaming" ||
      this.status === "submitted"
    ) {
      return;
    }

    const shouldSend = await this.#sendAutomaticallyWhen({
      messages: this.messages
    });
    // TypeScript narrows status after the earlier guard, but it can change
    // while `sendAutomaticallyWhen` awaits.
    const status = this.status as string;
    if (shouldSend && status !== "streaming" && status !== "submitted") {
      await this.sendMessage();
    }
  }

  #syncPendingToolCalls(): void {
    const currentToolCallIds = new Set<string>();
    for (const message of this.messages) {
      for (const part of message.parts) {
        if ("toolCallId" in part && part.toolCallId) {
          currentToolCallIds.add((part as { toolCallId: string }).toolCallId);
        }
      }
    }

    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "assistant") {
      this.#pendingToolCalls = [];
      for (const toolCallId of [...this.#toolCalls.keys()]) {
        if (!currentToolCallIds.has(toolCallId)) {
          this.#toolCalls.delete(toolCallId);
        }
      }
      return;
    }

    const pendingIds = new Set<string>();
    const pendingToolCalls: AgentChatToolCall[] = [];

    for (const part of last.parts) {
      if (
        !isToolUIPart(part) ||
        (part as { state?: string }).state !== "input-available"
      ) {
        continue;
      }

      const toolCallId = part.toolCallId;
      if (pendingIds.has(toolCallId)) {
        continue;
      }
      pendingIds.add(toolCallId);

      const existing = this.#toolCalls.get(toolCallId);
      if (existing) {
        existing.messageId = last.id;
        existing.input = (part as { input?: unknown }).input;
        if (!existing.handled) {
          pendingToolCalls.push(existing);
        }
        continue;
      }

      const toolName = getToolName(part);
      const toolCall = new AgentChatToolCall({
        toolCallId,
        toolName,
        messageId: last.id,
        input: (part as { input?: unknown }).input,
        addOutput: (opts) => {
          this.#sendToolOutputToServer(
            opts.toolCallId,
            toolName,
            opts.output,
            opts.state,
            opts.errorText
          );
          this.#applyToolOutputLocally({
            toolCallId: opts.toolCallId,
            messageId: opts.messageId,
            output: opts.output,
            ...(opts.state ? { state: opts.state } : {}),
            ...(opts.errorText !== undefined
              ? { errorText: opts.errorText }
              : {})
          });
          void this.#continueFromClientWhenConfigured().catch(() => {});
        }
      });
      this.#toolCalls.set(toolCallId, toolCall);
      pendingToolCalls.push(toolCall);
    }

    for (const toolCallId of [...this.#toolCalls.keys()]) {
      if (!currentToolCallIds.has(toolCallId)) {
        this.#toolCalls.delete(toolCallId);
      }
    }

    this.#pendingToolCalls = pendingToolCalls;
  }

  #preserveProtectedStreamingAssistant(messages: M[]): M[] {
    const protection = this.#protectedStreamingAssistant;
    if (!protection) {
      return messages;
    }

    const protectedAssistant =
      this.messages.find((message) => message.id === protection.assistantId) ??
      messages.find((message) => message.id === protection.assistantId);
    if (!protectedAssistant) {
      return messages;
    }

    return [
      ...messages.filter((message) => message.id !== protection.assistantId),
      protectedAssistant
    ];
  }

  #protectStreamingAssistantTail(): void {
    if (this.status !== "streaming") {
      return;
    }

    let assistantIndex = -1;
    let assistantMessage: M | undefined;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message?.role === "assistant") {
        assistantIndex = i;
        assistantMessage = message;
        break;
      }
    }

    if (!assistantMessage) {
      return;
    }

    if (
      this.#protectedStreamingAssistant?.assistantId !== assistantMessage.id
    ) {
      this.#protectedStreamingAssistant = {
        assistantId: assistantMessage.id,
        anchorMessageId: this.messages[assistantIndex - 1]?.id ?? null
      };
    }

    if (assistantIndex === this.messages.length - 1) {
      return;
    }

    const messages = [...this.messages];
    messages.splice(assistantIndex, 1);
    this.messages = [...messages, assistantMessage];
  }

  #restoreProtectedStreamingAssistant(assistantId?: string): void {
    const protection = this.#protectedStreamingAssistant;
    if (
      !protection ||
      assistantId === undefined ||
      protection.assistantId !== assistantId
    ) {
      return;
    }

    this.#protectedStreamingAssistant = null;

    const sourceIndex = this.messages.findIndex(
      (message) => message.id === protection.assistantId
    );
    if (sourceIndex < 0) {
      return;
    }

    const result = [...this.messages];
    const [message] = result.splice(sourceIndex, 1);
    if (!message) {
      return;
    }

    if (protection.anchorMessageId === null) {
      result.unshift(message);
    } else {
      const anchorIndex = result.findIndex(
        (candidate) => candidate.id === protection.anchorMessageId
      );
      result.splice(
        anchorIndex >= 0 ? anchorIndex + 1 : sourceIndex,
        0,
        message
      );
    }

    this.messages = result;
  }

  #updateMessageParts(
    matchesMessage: (message: M) => boolean,
    updatePart: (part: M["parts"][number]) => M["parts"][number]
  ): void {
    let changed = false;
    const next = this.messages.map((message) => {
      if (!matchesMessage(message)) {
        return message;
      }

      const parts = message.parts.map((part) => {
        const updated = updatePart(part);
        if (updated !== part) {
          changed = true;
        }
        return updated;
      });

      return { ...message, parts } as M;
    });

    if (changed) {
      this.messages = next;
    }
  }

  #applyToolOutputLocally(opts: {
    toolCallId: string;
    messageId: string;
    output?: unknown;
    state?: "output-available" | "output-error";
    errorText?: string;
  }): void {
    const toolCall = this.#toolCalls.get(opts.toolCallId);
    if (toolCall) {
      toolCall.handled = true;
      toolCall.running = false;
    }

    const state = opts.state ?? "output-available";
    const hasMessageId = this.messages.some(
      (message) => message.id === opts.messageId
    );
    this.#updateMessageParts(
      (message) =>
        message.id === opts.messageId ||
        (!hasMessageId &&
          message.parts.some(
            (part) => isToolUIPart(part) && part.toolCallId === opts.toolCallId
          )),
      (part) =>
        isToolUIPart(part) && part.toolCallId === opts.toolCallId
          ? { ...part, state, output: opts.output, errorText: opts.errorText }
          : part
    );
  }

  #applyToolApprovalLocally(opts: {
    id: string;
    approved: boolean;
    reason?: string;
  }): void {
    this.#updateMessageParts(
      (message) =>
        message.parts.some(
          (part) =>
            isToolUIPart(part) &&
            part.state === "approval-requested" &&
            part.approval.id === opts.id
        ),
      (part) =>
        isToolUIPart(part) &&
        part.state === "approval-requested" &&
        part.approval.id === opts.id
          ? {
              ...part,
              state: "approval-responded",
              approval: {
                id: opts.id,
                approved: opts.approved,
                reason: opts.reason
              }
            }
          : part
    );
  }

  #sendToolOutputToServer(
    toolCallId: string,
    toolName: string,
    output: unknown,
    state?: "output-available" | "output-error",
    errorText?: string
  ): void {
    if (this.#closed) {
      return;
    }

    const shouldAutoContinue =
      state === "output-error" ? false : this.#autoContinueAfterToolResult;

    this.#transport.sendToolResult({
      toolCallId,
      toolName,
      output,
      ...(state ? { state } : {}),
      ...(errorText !== undefined ? { errorText } : {}),
      autoContinue: shouldAutoContinue
    });
    if (shouldAutoContinue) {
      this.#startToolContinuation();
    }
  }

  #handleTransportEvent(event: AgentChatTransportEvent<M>): void {
    if (this.#closed) {
      return;
    }

    switch (event.type) {
      case "history-cleared":
        this.#resetLocalTransientState();
        this.#streamState.current = broadcastTransition(
          this.#streamState.current,
          { type: "clear" }
        ).state;
        this.isServerStreaming = false;
        this.messages = [];
        break;

      case "messages-replaced":
        this.messages = this.#preserveProtectedStreamingAssistant(
          event.messages
        );
        break;

      case "message-updated": {
        const updated = event.message;
        const prev = this.messages;
        let idx = prev.findIndex((m) => m.id === updated.id);
        if (idx < 0) {
          const ids = new Set(
            updated.parts
              .filter((p) => "toolCallId" in p && p.toolCallId)
              .map((p) => (p as { toolCallId: string }).toolCallId)
          );
          if (ids.size > 0) {
            idx = prev.findIndex((m) =>
              m.parts.some(
                (p) =>
                  "toolCallId" in p &&
                  ids.has((p as { toolCallId: string }).toolCallId)
              )
            );
          }
        }
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...updated, id: prev[idx].id };
          this.messages = next;
        }
        break;
      }

      case "broadcast-resume":
        this.#streamState.current = broadcastTransition(
          this.#streamState.current,
          {
            type: "resume-fallback",
            streamId: event.streamId,
            messageId: nanoid()
          }
        ).state;
        this.isServerStreaming = true;
        break;

      case "broadcast-response": {
        const result = broadcastTransition(this.#streamState.current, {
          type: "response",
          streamId: event.streamId,
          messageId: nanoid(),
          chunkData: event.chunkData,
          done: event.done,
          error: event.error,
          replay: event.replay,
          replayComplete: event.replayComplete,
          continuation: event.continuation,
          currentMessages: event.continuation ? this.messages : undefined
        });
        this.#streamState.current = result.state;
        if (result.messagesUpdate) {
          const updater = result.messagesUpdate as unknown as (
            prev: M[]
          ) => M[];
          this.messages = updater(this.messages);
        }
        this.isServerStreaming = result.isStreaming;
        break;
      }

      case "assistant-tail-released":
        this.#restoreProtectedStreamingAssistant(event.messageId);
        break;
    }
  }
}

export function createAgentChat<M extends UIMessage = UIMessage>(
  options: CreateAgentChatOptions<M>
): AgentChat<M> {
  const chat = new AgentChat<M>(options);
  onDestroy(() => chat.close());
  return chat;
}
