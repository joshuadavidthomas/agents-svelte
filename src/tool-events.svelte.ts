import { onDestroy } from "svelte";
import {
  applyAgentToolEvent,
  createAgentToolEventState,
  type AgentToolEvent,
  type AgentToolEventMessage,
  type AgentToolEventState,
  type AgentToolRunState,
} from "agents/chat";
import type { AgentToolInterruptedReason } from "agents/agent-tools";
import type { Agent } from "./agent.svelte.ts";

type AgentToolEventsSocket = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

export interface CreateAgentToolEventsOptions {
  agent: Agent<unknown, unknown>;
}

function agentToolDedupeKey(message: AgentToolEventMessage): string {
  return [message.parentToolCallId ?? "", message.event.runId, String(message.sequence)].join("\0");
}

export class AgentToolEvents {
  #state = $state<AgentToolEventState>(createAgentToolEventState());
  readonly #seen = new Set<string>();
  readonly #agent: Agent<unknown, unknown>;
  #socket: AgentToolEventsSocket | null = null;

  constructor(options: CreateAgentToolEventsOptions) {
    this.#agent = options.agent;
  }

  get runsById(): Record<string, AgentToolRunState> {
    return this.#state.runsById;
  }

  get runsByToolCallId(): Record<string, AgentToolRunState[]> {
    return this.#state.runsByToolCallId;
  }

  get unboundRuns(): AgentToolRunState[] {
    return this.#state.unboundRuns;
  }

  connect(socket: AgentToolEventsSocket | null = this.#agent.socket): void {
    if (this.#socket === socket) {
      return;
    }

    this.#detachCurrentSocket();
    if (!socket) {
      return;
    }

    socket.addEventListener("message", this.#handleMessage);
    this.#socket = socket;
  }

  close(): void {
    this.#detachCurrentSocket();
  }

  resetLocalState(): void {
    this.#seen.clear();
    this.#state = createAgentToolEventState();
  }

  getRunsForToolCall(toolCallId: string): AgentToolRunState[] {
    return this.#state.runsByToolCallId[toolCallId] ?? [];
  }

  #detachCurrentSocket(): void {
    if (!this.#socket) {
      return;
    }

    this.#socket.removeEventListener("message", this.#handleMessage);
    this.#socket = null;
  }

  #handleMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") {
      return;
    }

    let message: AgentToolEventMessage;
    try {
      message = JSON.parse(event.data) as AgentToolEventMessage;
    } catch {
      return;
    }

    if (message.type !== "agent-tool-event") {
      return;
    }

    const key = agentToolDedupeKey(message);
    if (this.#seen.has(key)) {
      return;
    }

    this.#seen.add(key);
    this.#state = applyAgentToolEvent(this.#state, message);
  };
}

export function createAgentToolEvents(options: CreateAgentToolEventsOptions): AgentToolEvents {
  const events = new AgentToolEvents(options);

  $effect(() => {
    const socket = options.agent.socket;
    events.connect(socket);
    return () => events.close();
  });

  onDestroy(() => events.close());
  return events;
}

export type {
  AgentToolEvent,
  AgentToolEventMessage,
  AgentToolEventState,
  AgentToolInterruptedReason,
  AgentToolRunState,
};
