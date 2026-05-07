import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

export type Env = {
  AI: Ai;
  ChatAgent: DurableObjectNamespace<ChatAgent>;
};

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(_onFinish: unknown, _options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it"),
      system: "You are a concise assistant in a SvelteKit example for Cloudflare Agents.",
      messages: await convertToModelMessages(this.messages),
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
