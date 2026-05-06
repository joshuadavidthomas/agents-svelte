import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { Agent, routeAgentRequest } from "agents";
import type { AgentToolEvent, AgentToolEventMessage } from "agents/chat";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolExecutionOptions,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

export const DEMO_USER = "demo-user";

type Env = {
  AI: Ai;
  Assistant: DurableObjectNamespace<Assistant>;
};

type ResearchInput = { query: string };
type PlanInput = { description: string };
type HelperResult = { summary: string };

function inputText(input: unknown): string {
  if (typeof input === "string") return input;
  return JSON.stringify(input, null, 2);
}

abstract class HelperAgent extends Agent<Env> {
  protected abstract systemPrompt(input: string): string;

  async run(input: unknown, onStreamChunk?: (body: string) => void): Promise<HelperResult> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it", { sessionAffinity: this.sessionAffinity }),
      system: this.systemPrompt(inputText(input)),
      prompt: inputText(input),
    });

    let summary = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        summary += part.text;
        onStreamChunk?.(JSON.stringify({ type: "text-delta", delta: part.text }));
      } else if (part.type === "reasoning-start") {
        onStreamChunk?.(JSON.stringify({ type: "reasoning-start" }));
      } else if (part.type === "reasoning-delta") {
        onStreamChunk?.(JSON.stringify({ type: "reasoning-delta", delta: part.text }));
      } else if (part.type === "reasoning-end") {
        onStreamChunk?.(JSON.stringify({ type: "reasoning-end" }));
      }
    }

    return { summary };
  }
}

export class Researcher extends HelperAgent {
  protected systemPrompt(input: string): string {
    return [
      "You are a focused research helper agent.",
      "Investigate the topic and return a concise grounded summary.",
      `Topic: ${input}`,
    ].join("\n");
  }
}

export class Planner extends HelperAgent {
  protected systemPrompt(input: string): string {
    return [
      "You are a focused implementation planning helper agent.",
      "Return a concrete plan with affected files, steps, and risks.",
      `Request: ${input}`,
    ].join("\n");
  }
}

export class Assistant extends AIChatAgent<Env> {
  async #runHelper<TInput>(
    Helper: new (...args: ConstructorParameters<typeof Agent<Env>>) => HelperAgent,
    options: ToolExecutionOptions,
    config: {
      input: TInput;
      agentType: string;
      displayName: string;
      order?: number;
    },
  ): Promise<HelperResult> {
    const runId = crypto.randomUUID();
    const order = config.order ?? 0;

    this.#emitToolEvent(options.toolCallId, 0, {
      kind: "started",
      runId,
      agentType: config.agentType,
      inputPreview: config.input,
      order,
      display: { name: config.displayName },
    });

    try {
      const helper = await this.subAgent(Helper, runId);
      let sequence = 1;
      const result = await helper.run(config.input, (body) => {
        this.#emitToolEvent(options.toolCallId, sequence++, {
          kind: "chunk",
          runId,
          body,
        });
      });
      this.#emitToolEvent(options.toolCallId, sequence, {
        kind: "finished",
        runId,
        summary: result.summary,
      });
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
    const result = streamText({
      abortSignal: options?.abortSignal,
      model: workersai("@cf/google/gemma-4-26b-a4b-it", { sessionAffinity: this.sessionAffinity }),
      system: [
        "You are a concise assistant.",
        "Use research for background questions, plan for implementation planning, and compare for two-topic comparisons.",
        "After helper tools return, answer briefly using their summaries.",
      ].join("\n"),
      messages: await convertToModelMessages(this.messages),
      stopWhen: stepCountIs(5),
      tools: {
        research: tool({
          description: "Dispatch a Researcher agent to investigate a topic.",
          inputSchema: z.object({ query: z.string().min(3) }),
          execute: ({ query }: ResearchInput, options) =>
            this.#runHelper(Researcher, options, {
              input: { query },
              agentType: "Researcher",
              displayName: "Researcher",
            }),
        }),
        plan: tool({
          description: "Dispatch a Planner agent to produce an implementation plan.",
          inputSchema: z.object({ description: z.string().min(5) }),
          execute: ({ description }: PlanInput, options) =>
            this.#runHelper(Planner, options, {
              input: { description },
              agentType: "Planner",
              displayName: "Planner",
            }),
        }),
        compare: tool({
          description: "Dispatch two Researcher agents in parallel to compare topics.",
          inputSchema: z.object({ a: z.string().min(3), b: z.string().min(3) }),
          execute: async ({ a, b }: { a: string; b: string }, options) => {
            const [left, right] = await Promise.all([
              this.#runHelper(Researcher, options, {
                input: { query: a },
                agentType: "Researcher",
                displayName: "Researcher A",
                order: 0,
              }),
              this.#runHelper(Researcher, options, {
                input: { query: b },
                agentType: "Researcher",
                displayName: "Researcher B",
                order: 1,
              }),
            ]);
            return { a: left.summary, b: right.summary };
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  },
};
