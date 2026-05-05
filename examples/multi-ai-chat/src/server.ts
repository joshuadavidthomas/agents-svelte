import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest, Agent, callable } from "agents";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolExecutionOptions,
} from "ai";
import type { AgentToolEvent, AgentToolEventMessage } from "agents/chat";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

const DEMO_USER = "demo-user";
const MEMORY_LABEL = "memory";

type Env = {
  AI: Ai;
  Inbox: DurableObjectNamespace<Inbox>;
};

type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
};

type InboxState = {
  chats: ChatSummary[];
};

function defaultTitle() {
  return `Chat — ${new Date().toISOString().slice(0, 10)}`;
}

function createId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export class Inbox extends Agent<Env, InboxState> {
  initialState = { chats: [] };

  async onStart() {
    void this
      .sql`CREATE TABLE IF NOT EXISTS chat_meta (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_message_preview TEXT)`;
    void this
      .sql`CREATE TABLE IF NOT EXISTS inbox_memory (label TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL)`;
    await this.refreshState();
  }

  override async onBeforeSubAgent(_request: Request, child: { className: string; name: string }) {
    if (!this.hasSubAgent(child.className, child.name)) {
      return new Response(`${child.className} "${child.name}" not found`, { status: 404 });
    }
  }

  @callable()
  async createChat(opts?: { title?: string }) {
    const id = createId();
    const now = new Date().toISOString();
    const title = opts?.title?.trim() || defaultTitle();
    await this.subAgent(Chat, id);
    void this
      .sql`INSERT INTO chat_meta (id, title, created_at, updated_at) VALUES (${id}, ${title}, ${now}, ${now})`;
    await this.refreshState();
    return id;
  }

  @callable()
  async renameChat(id: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const now = new Date().toISOString();
    void this.sql`UPDATE chat_meta SET title = ${nextTitle}, updated_at = ${now} WHERE id = ${id}`;
    await this.refreshState();
  }

  @callable()
  async deleteChat(id: string) {
    await this.deleteSubAgent(Chat, id);
    void this.sql`DELETE FROM chat_meta WHERE id = ${id}`;
    await this.refreshState();
  }

  @callable()
  async getSharedMemory(label = MEMORY_LABEL) {
    const rows = this.sql<{
      content: string;
    }>`SELECT content FROM inbox_memory WHERE label = ${label} LIMIT 1`;
    return rows[0]?.content ?? "";
  }

  @callable()
  async setSharedMemory(label = MEMORY_LABEL, content: string) {
    const now = new Date().toISOString();
    void this
      .sql`INSERT INTO inbox_memory (label, content, updated_at) VALUES (${label}, ${content}, ${now}) ON CONFLICT(label) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`;
    return content;
  }

  @callable()
  async recordChatTurn(chatId: string, preview: string) {
    const now = new Date().toISOString();
    void this
      .sql`UPDATE chat_meta SET updated_at = ${now}, last_message_preview = ${preview} WHERE id = ${chatId}`;
    await this.refreshState();
  }

  async refreshState() {
    const rows = this
      .sql<ChatSummary>`SELECT id, title, created_at as createdAt, updated_at as updatedAt, last_message_preview as lastMessagePreview FROM chat_meta ORDER BY updated_at DESC`;
    this.setState({ chats: [...rows] });
  }
}

export class Chat extends AIChatAgent<Env> {
  async #withToolEvent<T>(
    options: ToolExecutionOptions,
    event: {
      agentType: string;
      displayName: string;
      inputPreview?: unknown;
    },
    run: () => Promise<T>,
    summarize: (result: T) => string,
  ): Promise<T> {
    const runId = crypto.randomUUID();
    this.#emitToolEvent(options.toolCallId, 0, {
      kind: "started",
      runId,
      agentType: event.agentType,
      inputPreview: event.inputPreview,
      order: 0,
      display: { name: event.displayName },
    });

    try {
      const result = await run();
      const summary = summarize(result);
      this.#emitToolEvent(options.toolCallId, 1, {
        kind: "chunk",
        runId,
        body: JSON.stringify({ type: "text-delta", delta: summary }),
      });
      this.#emitToolEvent(options.toolCallId, 2, { kind: "finished", runId, summary });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#emitToolEvent(options.toolCallId, 1, { kind: "error", runId, error: message });
      throw error;
    }
  }

  #emitToolEvent(parentToolCallId: string | undefined, sequence: number, event: AgentToolEvent) {
    const message: AgentToolEventMessage = {
      type: "agent-tool-event",
      ...(parentToolCallId ? { parentToolCallId } : {}),
      sequence,
      event,
    };
    this.broadcast(JSON.stringify(message));
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const inbox = await this.parentAgent(Inbox);
    const memory = await inbox.getSharedMemory(MEMORY_LABEL);
    const system = [
      "You are a friendly assistant. Keep replies concise.",
      memory ? `Shared memory for this user:\n${memory}` : "No shared memory has been saved yet.",
      "Use tools when the user asks you to remember facts, recall memory, or get the current time.",
    ].join("\n\n");

    const result = streamText({
      abortSignal: options?.abortSignal,
      model: workersai("@cf/google/gemma-4-26b-a4b-it", { sessionAffinity: this.sessionAffinity }),
      system,
      messages: await convertToModelMessages(this.messages),
      stopWhen: stepCountIs(5),
      tools: {
        rememberFact: tool({
          description: "Save a fact to shared memory for all chats in this inbox.",
          inputSchema: z.object({ fact: z.string() }),
          execute: async ({ fact }, options) =>
            this.#withToolEvent(
              options,
              {
                agentType: "MemoryTool",
                displayName: "Remember fact",
                inputPreview: fact,
              },
              async () => {
                const current = await inbox.getSharedMemory(MEMORY_LABEL);
                const next = `${current.trim()}\n- ${fact}`.trim();
                await inbox.setSharedMemory(MEMORY_LABEL, next);
                return { remembered: fact };
              },
              ({ remembered }) => `Saved fact: ${remembered}`,
            ),
        }),
        recallMemory: tool({
          description: "Read shared memory for this inbox.",
          inputSchema: z.object({}),
          execute: async (_input, options) =>
            this.#withToolEvent(
              options,
              {
                agentType: "MemoryTool",
                displayName: "Recall memory",
              },
              async () => {
                const content = await inbox.getSharedMemory(MEMORY_LABEL);
                return { content, facts: content.split("\n").filter(Boolean).length };
              },
              ({ facts }) => `Found ${facts} saved ${facts === 1 ? "fact" : "facts"}.`,
            ),
        }),
        getCurrentTime: tool({
          description: "Get the current UTC time.",
          inputSchema: z.object({}),
          execute: async (_input, options) =>
            this.#withToolEvent(
              options,
              {
                agentType: "TimeTool",
                displayName: "Current time",
              },
              async () => ({ now: new Date().toISOString(), timeZone: "UTC" }),
              ({ now }) => `Current UTC time: ${now}`,
            ),
        }),
      },
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type !== "finish") return undefined;
        return {
          usage: {
            inputTokens: part.totalUsage.inputTokens,
            outputTokens: part.totalUsage.outputTokens,
            totalTokens: part.totalUsage.totalTokens,
          },
        };
      },
    });
  }

  async onChatResponse() {
    const inbox = await this.parentAgent(Inbox);
    const latest = this.messages.at(-1);
    const preview =
      latest?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .slice(0, 120) || "No messages yet";
    await inbox.recordChatTurn(this.name, preview);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  },
};

export { DEMO_USER };
