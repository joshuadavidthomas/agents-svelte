import { onDestroy, onMount } from "svelte";
import { Chat } from "@ai-sdk/svelte";
import { AgentChatTransport, type AgentChatTransportEvent } from "./chat-transport.ts";
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
      ...opts,
    });
  }

  async run(
    handler: (input: unknown, toolCall: AgentChatToolCall) => unknown | Promise<unknown>,
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
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.lastError = normalized;
        if (!this.handled) {
          this.addOutput({
            state: "output-error",
            errorText: normalized.message,
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

export type PrepareSendMessagesRequestOptions<M extends UIMessage = UIMessage> = {
  id: string;
  messages: M[];
  trigger: "submit-message" | "regenerate-message";
  messageId?: string;
};

export type PrepareSendMessagesRequestResult = {
  body?: Record<string, unknown>;
};

export interface CreateAgentChatOptions<M extends UIMessage = UIMessage> extends Omit<
  ChatInit<M>,
  "transport" | "onToolCall" | "id" | "messages"
> {
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
    options: PrepareSendMessagesRequestOptions<M>,
  ) => PrepareSendMessagesRequestResult | Promise<PrepareSendMessagesRequestResult>;
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
      },
): Promise<M[]> {
  let url: string;
  if ("url" in options) {
    url = options.url;
  } else {
    const slug = camelCaseToKebabCase(options.agent);
    const base = options.host.replace(/\/$/, "");
    url = `${base}/agents/${slug}/${options.name}/get-messages`;
  }
  const r = await fetch(url, {
    credentials: options.credentials,
    headers: options.headers,
  });
  if (!r.ok) {
    throw new Error(
      `[agents-svelte/chat] Failed to load initial messages: ${r.status} ${r.statusText}`,
    );
  }
  const text = await r.text();
  if (!text.trim()) return [];
  return JSON.parse(text) as M[];
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

  readonly #options: CreateAgentChatOptions<M>;
  readonly #autoContinueAfterToolResult: boolean;
  readonly #sendAutomaticallyWhen?: ChatInit<M>["sendAutomaticallyWhen"];
  readonly #toolCalls = new Map<string, AgentChatToolCall>();
  #protectedStreamingAssistant: {
    assistantId: string;
    anchorMessageId: string | null;
  } | null = null;
  #connected = false;
  #ownsAgentConnection = false;
  #closed = false;
  readonly #continuationStreamsSeeded = new Set<string>();
  readonly #observedBroadcastResumes = new Set<string>();
  readonly #replayHydratedAssistantIds = new Set<string>();
  #clientContinuationPromise: Promise<void> | null = null;
  #clientContinuationRequested = false;
  #cleanupPendingToolCallsEffect: (() => void) | null = null;
  readonly #streamState: { current: BroadcastStreamState } = {
    current: { status: "idle" } as BroadcastStreamState,
  };

  constructor(options: CreateAgentChatOptions<M>) {
    const {
      agent,
      getInitialMessages,
      initialMessages,
      body: bodyOption,
      prepareSendMessagesRequest,
      autoContinueAfterToolResult = true,
      sendAutomaticallyWhen,
      ...chatInit
    } = options;

    const cacheKey = `${agent.path
      .map((segment) => `${segment.agent}/${segment.name}`)
      .join("/")}|${agent.identity.agent}|${agent.identity.name}`;

    const transport = new AgentChatTransport<M>({
      getConnection: () => {
        const socket = agent.socket;
        return socket
          ? {
              send: (data: string) => socket.send(data),
              addEventListener: (type: string, listener: (event: MessageEvent) => void) =>
                socket.addEventListener(type, listener as EventListener),
              removeEventListener: (type: string, listener: (event: MessageEvent) => void) =>
                socket.removeEventListener(type, listener as EventListener),
            }
          : null;
      },
      prepareBody: async ({ messages: msgs, trigger, messageId }) => {
        let extra: Record<string, unknown> = {};
        if (bodyOption) {
          const resolved = typeof bodyOption === "function" ? await bodyOption() : bodyOption;
          extra = { ...resolved };
        }
        if (prepareSendMessagesRequest) {
          const result = await prepareSendMessagesRequest({
            id: cacheKey,
            messages: msgs,
            trigger,
            messageId,
          });
          if (result.body) Object.assign(extra, result.body);
        }
        return extra;
      },
    });

    super({
      ...chatInit,
      id: cacheKey,
      transport,
      messages: initialMessages ?? [],
      sendAutomaticallyWhen,
    });

    // @ai-sdk/svelte installs these as instance fields in its constructor.
    // `declare ...: never` hides them from TypeScript, but runtime deletion is
    // still needed so AgentChat has one Svelte-shaped tool output surface.
    delete (this as unknown as { addToolOutput?: unknown }).addToolOutput;
    delete (this as unknown as { addToolResult?: unknown }).addToolResult;

    this.#options = options;
    this.#transport = transport;
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

    const baseSendMessage = this.sendMessage.bind(this) as Chat<M>["sendMessage"];
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

    if (getInitialMessages === null || initialMessages) {
      this.initialized = true;
    }

    this.#cleanupPendingToolCallsEffect = $effect.root(() => {
      $effect(() => {
        this.#syncPendingToolCalls();
      });

      $effect(() => {
        this.#collapseHydratedReplayTextParts();
      });
    });
  }

  connect(): void {
    if (this.#closed || this.#connected) return;

    const {
      agent,
      getInitialMessages,
      initialMessages,
      credentials,
      headers,
      resume = true,
    } = this.#options;

    const agentWasConnected = agent.socket !== null;

    try {
      this.#ownsAgentConnection = !agentWasConnected;
      agent.connect();
      const agentUrl = new URL(agent.getHttpUrl());
      agentUrl.searchParams.delete("_pk");
      const agentUrlString = agentUrl.toString();

      this.#transport.start({
        onEvent: (event) => this.#handleTransportEvent(event),
        shouldAcceptBroadcastResume: () => resume && !this.#closed,
      });
      this.#connected = true;

      const initialPromise: Promise<M[]> =
        getInitialMessages === null
          ? Promise.resolve(initialMessages ?? [])
          : getInitialMessages
            ? getInitialMessages({
                agent: agent.identity.agent,
                name: agent.identity.name,
                url: agentUrlString,
              })
            : getAgentMessages<M>({
                url: `${agentUrlString.replace(/\/$/, "")}/get-messages`,
                credentials,
                headers,
              });

      initialPromise
        .then((msgs) => {
          if (this.#closed) return;
          if (msgs.length > 0 && this.messages.length === 0) this.messages = msgs;
          this.initialLoadError = null;
          this.initialized = true;
          if (resume) void this.resumeStream().catch(() => {});
        })
        .catch((e) => {
          if (this.#closed) return;
          this.initialLoadError = e instanceof Error ? e : new Error(String(e));
          this.initialized = true;
        });
    } catch (error) {
      this.#connected = false;
      this.#transport.close();
      if (this.#ownsAgentConnection) {
        agent.close();
        this.#ownsAgentConnection = false;
      }
      throw error;
    }
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
        if (isToolUIPart(p) && p.state === "approval-requested" && p.approval.id === opts.id) {
          toolCallId = p.toolCallId;
          break;
        }
      }
      if (toolCallId) break;
    }
    if (toolCallId) {
      this.#applyToolApprovalLocally(opts);
      this.#transport.sendToolApproval({
        toolCallId,
        approved: opts.approved,
        autoContinue: this.#autoContinueAfterToolResult,
      });
      if (this.#autoContinueAfterToolResult) {
        this.#startToolContinuation();
      }
    } else {
      const knownApproval = this.messages.some((message) =>
        message.parts.some((part) => {
          const approval = (part as { approval?: { id: string } }).approval;
          return approval?.id === opts.id;
        }),
      );
      if (!knownApproval) {
        console.warn(
          `[agents-svelte/chat] addToolApprovalResponse: no toolCallId for approval id "${opts.id}". Server will not be notified.`,
        );
      }
      return;
    }
    void this.#continueFromClientWhenConfigured().catch(() => {});
  };

  setMessages(next: M[] | ((prev: M[]) => M[]), options?: { skipServerSync?: boolean }): void {
    if (this.#closed) {
      return;
    }

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
    if (this.#ownsAgentConnection) {
      this.#options.agent.close();
      this.#ownsAgentConnection = false;
    }
  }

  #resetLocalTransientState(): void {
    this.#toolCalls.clear();
    this.#pendingToolCalls = [];
    this.#protectedStreamingAssistant = null;
    this.#observedBroadcastResumes.clear();
    this.#replayHydratedAssistantIds.clear();
  }

  #startToolContinuation(): void {
    if (this.#closed) {
      return;
    }

    this.#protectCurrentAssistantTail();
    this.#transport.prepareToolContinuation();
    void this.resumeStream().catch(() => {});
  }

  #resetStreamState(): void {
    this.#streamState.current = { status: "idle" } as BroadcastStreamState;
    this.#continuationStreamsSeeded.clear();
    this.#observedBroadcastResumes.clear();
    this.isServerStreaming = false;
  }

  #continueFromClientWhenConfigured(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    this.#clientContinuationRequested = true;
    if (!this.#clientContinuationPromise) {
      this.#clientContinuationPromise = this.#drainClientContinuationRequests().finally(() => {
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
      messages: this.messages,
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
      for (const toolCallId of this.#toolCalls.keys()) {
        if (!currentToolCallIds.has(toolCallId)) {
          this.#toolCalls.delete(toolCallId);
        }
      }
      this.#pendingToolCalls = [];
      return;
    }

    const pendingIds = new Set<string>();
    const pendingToolCalls: AgentChatToolCall[] = [];

    for (const part of last.parts) {
      if (!isToolUIPart(part) || (part as { state?: string }).state !== "input-available") {
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
          this.#applyToolOutputLocally({
            toolCallId: opts.toolCallId,
            messageId: opts.messageId,
            output: opts.output,
            ...(opts.state ? { state: opts.state } : {}),
            ...(opts.errorText !== undefined ? { errorText: opts.errorText } : {}),
          });
          this.#sendToolOutputToServer(
            opts.toolCallId,
            toolName,
            opts.output,
            opts.state,
            opts.errorText,
          );
          void this.#continueFromClientWhenConfigured().catch(() => {});
        },
      });
      this.#toolCalls.set(toolCallId, toolCall);
      pendingToolCalls.push(toolCall);
    }

    for (const toolCallId of this.#toolCalls.keys()) {
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
      protectedAssistant,
    ];
  }

  #protectStreamingAssistantTail(): void {
    if (this.status !== "streaming") {
      return;
    }

    this.#protectLastAssistantTail();
  }

  #protectCurrentAssistantTail(): void {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant") {
      return;
    }

    this.#protectedStreamingAssistant = {
      assistantId: last.id,
      anchorMessageId: this.messages.at(-2)?.id ?? null,
    };
  }

  #protectLastAssistantTail(): void {
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

    if (this.#protectedStreamingAssistant?.assistantId !== assistantMessage.id) {
      this.#protectedStreamingAssistant = {
        assistantId: assistantMessage.id,
        anchorMessageId: this.messages[assistantIndex - 1]?.id ?? null,
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
    if (!protection || assistantId === undefined || protection.assistantId !== assistantId) {
      return;
    }

    this.#protectedStreamingAssistant = null;

    const sourceIndex = this.messages.findIndex((message) => message.id === protection.assistantId);
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
        (candidate) => candidate.id === protection.anchorMessageId,
      );
      result.splice(anchorIndex >= 0 ? anchorIndex + 1 : sourceIndex, 0, message);
    }

    this.messages = result;
  }

  #messagesForContinuation(chunkData: unknown): M[] {
    const repair = this.#isMissingStartDelta(chunkData);
    if (!repair) {
      return this.messages;
    }

    const assistantIndex = this.#lastAssistantIndex(this.messages);
    const assistant = this.messages[assistantIndex];
    if (assistantIndex < 0 || !assistant) {
      return this.messages;
    }

    const lastSameType = [...assistant.parts]
      .reverse()
      .find((part) => part.type === repair.partType) as
      | ({ state?: string } & M["parts"][number])
      | undefined;
    if (lastSameType?.state === "streaming") {
      return this.messages;
    }

    const next = [...this.messages];
    next[assistantIndex] = {
      ...assistant,
      parts: [...assistant.parts, repair.part],
    };
    return next;
  }

  #isMissingStartDelta(chunkData: unknown):
    | false
    | {
        partType: "text" | "reasoning";
        part: M["parts"][number];
      } {
    if (typeof chunkData !== "object" || chunkData === null) {
      return false;
    }

    const chunk = chunkData as { type?: unknown; delta?: unknown };
    if (chunk.type === "text-delta") {
      return {
        partType: "text",
        part: {
          type: "text",
          text: "",
          state: "streaming",
        } as M["parts"][number],
      };
    }
    if (chunk.type === "reasoning-delta") {
      return {
        partType: "reasoning",
        part: {
          type: "reasoning",
          text: "",
          state: "streaming",
        } as M["parts"][number],
      };
    }

    return false;
  }

  #lastAssistantIndex(messages: readonly M[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        return i;
      }
    }
    return -1;
  }

  #updateMessageParts(
    matchesMessage: (message: M) => boolean,
    updatePart: (part: M["parts"][number]) => M["parts"][number],
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
    const hasMessageId = this.messages.some((message) => message.id === opts.messageId);
    this.#updateMessageParts(
      (message) =>
        message.id === opts.messageId ||
        (!hasMessageId &&
          message.parts.some((part) => isToolUIPart(part) && part.toolCallId === opts.toolCallId)),
      (part) =>
        isToolUIPart(part) && part.toolCallId === opts.toolCallId
          ? { ...part, state, output: opts.output, errorText: opts.errorText }
          : part,
    );
  }

  #applyToolApprovalLocally(opts: { id: string; approved: boolean; reason?: string }): void {
    this.#updateMessageParts(
      (message) =>
        message.parts.some(
          (part) =>
            isToolUIPart(part) &&
            part.state === "approval-requested" &&
            part.approval.id === opts.id,
        ),
      (part) =>
        isToolUIPart(part) && part.state === "approval-requested" && part.approval.id === opts.id
          ? {
              ...part,
              state: "approval-responded",
              approval: {
                id: opts.id,
                approved: opts.approved,
                reason: opts.reason,
              },
            }
          : part,
    );
  }

  #resetHydratedAssistantForReplay(messageId: string): void {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant" || last.id !== messageId) {
      return;
    }

    this.messages = [
      ...this.messages.slice(0, -1),
      {
        ...last,
        parts: [],
      } as M,
    ];
    this.#replayHydratedAssistantIds.add(messageId);
  }

  #collapseHydratedReplayTextParts(): void {
    if (this.#replayHydratedAssistantIds.size === 0) {
      return;
    }

    let changed = false;
    const messages = this.messages.map((message) => {
      if (!this.#replayHydratedAssistantIds.has(message.id)) {
        return message;
      }

      const parts = message.parts;
      const nextParts = parts.filter((_, index) => !this.#isHydratedReplayTextPrefix(parts, index));
      if (nextParts.length === parts.length) {
        return message;
      }

      changed = true;
      return { ...message, parts: nextParts } as M;
    });

    if (changed) {
      this.messages = messages;
    }
  }

  #isHydratedReplayTextPrefix(parts: M["parts"], index: number): boolean {
    const text = this.#textPartText(parts[index]);
    return (
      text !== null &&
      parts.slice(index + 1).some((part) => {
        const laterText = this.#textPartText(part);
        return laterText !== null && laterText !== text && laterText.startsWith(text);
      })
    );
  }

  #textPartText(part: M["parts"][number] | undefined): string | null {
    return part?.type === "text" && "text" in part && typeof part.text === "string"
      ? part.text
      : null;
  }

  #sendToolOutputToServer(
    toolCallId: string,
    toolName: string,
    output: unknown,
    state?: "output-available" | "output-error",
    errorText?: string,
  ): void {
    if (this.#closed) {
      return;
    }

    const shouldAutoContinue = state === "output-error" ? false : this.#autoContinueAfterToolResult;

    this.#transport.sendToolResult({
      toolCallId,
      toolName,
      output,
      ...(state ? { state } : {}),
      ...(errorText !== undefined ? { errorText } : {}),
      autoContinue: shouldAutoContinue,
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
        this.#streamState.current = broadcastTransition(this.#streamState.current, {
          type: "clear",
        }).state;
        this.isServerStreaming = false;
        this.messages = [];
        break;

      case "messages-replaced":
        this.messages = this.#preserveProtectedStreamingAssistant(event.messages);
        this.#collapseHydratedReplayTextParts();
        break;

      case "message-updated": {
        if (this.#protectedStreamingAssistant?.assistantId === event.message.id) {
          break;
        }

        const updated = event.message;
        const prev = this.messages;
        let idx = prev.findIndex((m) => m.id === updated.id);
        if (idx < 0) {
          const ids = new Set(
            updated.parts
              .filter((p) => "toolCallId" in p && p.toolCallId)
              .map((p) => (p as { toolCallId: string }).toolCallId),
          );
          if (ids.size > 0) {
            idx = prev.findIndex((m) =>
              m.parts.some(
                (p) => "toolCallId" in p && ids.has((p as { toolCallId: string }).toolCallId),
              ),
            );
          }
        }
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...updated, id: prev[idx].id };
          this.messages = next;
          this.#collapseHydratedReplayTextParts();
        }
        break;
      }

      case "broadcast-resume":
        this.#observedBroadcastResumes.add(event.streamId);
        this.#streamState.current = broadcastTransition(this.#streamState.current, {
          type: "resume-fallback",
          streamId: event.streamId,
          messageId: nanoid(),
        }).state;
        this.isServerStreaming = true;
        break;

      case "broadcast-response": {
        if (
          event.replay &&
          this.#streamState.current.status !== "observing" &&
          !this.#observedBroadcastResumes.has(event.streamId)
        ) {
          return;
        }

        if (event.continuation && !this.#continuationStreamsSeeded.has(event.streamId)) {
          this.#streamState.current = { status: "idle" } as BroadcastStreamState;
          this.#continuationStreamsSeeded.add(event.streamId);
        }

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
          currentMessages: event.continuation
            ? this.#messagesForContinuation(event.chunkData)
            : undefined,
        });
        this.#streamState.current = result.state;
        if (result.messagesUpdate) {
          const updater = result.messagesUpdate as unknown as (prev: M[]) => M[];
          this.messages = updater(this.messages);
          this.#collapseHydratedReplayTextParts();
        }
        this.isServerStreaming = result.isStreaming;
        if (event.done || event.replayComplete || event.error) {
          this.#continuationStreamsSeeded.delete(event.streamId);
          this.#observedBroadcastResumes.delete(event.streamId);
        }
        break;
      }

      case "replay-hydrated-reset":
        this.#resetHydratedAssistantForReplay(event.messageId);
        break;

      case "assistant-tail-released":
        this.#restoreProtectedStreamingAssistant(event.messageId);
        break;
    }
  }
}

export function createAgentChat<M extends UIMessage = UIMessage>(
  options: CreateAgentChatOptions<M>,
): AgentChat<M> {
  const chat = new AgentChat<M>(options);
  onMount(() => chat.connect());
  onDestroy(() => chat.close());
  return chat;
}
