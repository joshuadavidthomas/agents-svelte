import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

const MODEL_ID = "@cf/moonshotai/kimi-k2.6";

type Env = {
  AI: Ai;
  ChatAgent: DurableObjectNamespace<ChatAgent>;
};

const tools = {
  getWeatherInformation: tool({
    description:
      "Get the current weather information for a specific city. Always use this tool when the user asks about weather.",
    inputSchema: z.object({
      city: z.string().describe("The name of the city to get weather for"),
    }),
    needsApproval: true,
    execute: async ({ city }) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return `The weather in ${city} is sunny, 72°F, with a light breeze.`;
    },
  }),
  getLocalTime: tool({
    description: "Get the local time for a specified location",
    inputSchema: z.object({
      location: z.string().describe("The location to get time for"),
    }),
  }),
  getLocalNews: tool({
    description: "Get local news for a specified location",
    inputSchema: z.object({
      location: z.string().describe("The location to get news for"),
    }),
    execute: async ({ location }) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return `Local news for ${location}: community events are planned this weekend, transit is running normally, and parks are open.`;
    },
  }),
};

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(_onFinish: unknown, _options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai(MODEL_ID, { sessionAffinity: this.sessionAffinity }),
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
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
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
