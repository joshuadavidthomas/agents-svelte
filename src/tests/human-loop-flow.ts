import type { UIMessage } from "ai";
import { MessageType } from "@cloudflare/ai-chat/types";
import type { MockAgent } from "./mock-agent.ts";

export const weatherApprovalFlow = {
  userId: "user-weather",
  assistantId: "assistant-weather",
  toolCallId: "call-weather",
  approvalId: "approval-weather",
  streamId: "approval-continuation",
  initialReasoning: "Initial reasoning",
  finalReasoning: "Final reasoning",
  toolOutput: "The weather in Los Angeles is sunny, 72°F.",
  finalText: "Here is the approved weather.",
} as const;

export function weatherApprovalInitialMessages(): UIMessage[] {
  return [
    {
      id: weatherApprovalFlow.userId,
      role: "user",
      parts: [{ type: "text", text: "weather in LA" }],
    },
    {
      id: weatherApprovalFlow.assistantId,
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: weatherApprovalFlow.initialReasoning,
          state: "done",
        },
        {
          type: "tool-getWeatherInformation",
          toolCallId: weatherApprovalFlow.toolCallId,
          state: "approval-requested",
          input: { city: "Los Angeles" },
          approval: { id: weatherApprovalFlow.approvalId },
        } as never,
      ],
    },
  ];
}

export function staleWeatherApprovalAssistant(): UIMessage {
  return {
    id: weatherApprovalFlow.assistantId,
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: weatherApprovalFlow.initialReasoning,
        state: "done",
      },
      {
        type: "tool-getWeatherInformation",
        toolCallId: weatherApprovalFlow.toolCallId,
        state: "output-available",
        input: { city: "Los Angeles" },
        output: weatherApprovalFlow.toolOutput,
        approval: { id: weatherApprovalFlow.approvalId, approved: true },
      } as never,
    ],
  };
}

export function dispatchWeatherApprovalContinuationStart(
  mock: MockAgent,
  streamId = weatherApprovalFlow.streamId,
): void {
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_STREAM_RESUMING,
    id: streamId,
  });
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: streamId,
    body: JSON.stringify({
      type: "tool-output-available",
      toolCallId: weatherApprovalFlow.toolCallId,
      output: weatherApprovalFlow.toolOutput,
    }),
    done: false,
    continuation: true,
  });
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: streamId,
    body: JSON.stringify({
      type: "reasoning-delta",
      id: "reason-final",
      delta: weatherApprovalFlow.finalReasoning,
    }),
    done: false,
    continuation: true,
  });
}

export function dispatchStaleWeatherApprovalSync(mock: MockAgent): void {
  const staleAssistant = staleWeatherApprovalAssistant();
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_MESSAGE_UPDATED,
    message: staleAssistant,
  });
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_CHAT_MESSAGES,
    messages: [weatherApprovalInitialMessages()[0], staleAssistant],
  });
}

export function dispatchWeatherApprovalContinuationFinish(
  mock: MockAgent,
  streamId = weatherApprovalFlow.streamId,
): void {
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: streamId,
    body: JSON.stringify({ type: "reasoning-end", id: "reason-final" }),
    done: false,
    continuation: true,
  });
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: streamId,
    body: JSON.stringify({
      type: "text-delta",
      id: "text-final",
      delta: weatherApprovalFlow.finalText,
    }),
    done: false,
    continuation: true,
  });
  mock.dispatchServerMessage({
    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
    id: streamId,
    body: "",
    done: true,
    continuation: true,
  });
}

export function expectedWeatherApprovalFinalParts(): UIMessage["parts"] {
  return [
    {
      type: "reasoning",
      text: weatherApprovalFlow.initialReasoning,
      state: "done",
    },
    {
      type: "tool-getWeatherInformation",
      toolCallId: weatherApprovalFlow.toolCallId,
      state: "output-available",
      input: { city: "Los Angeles" },
      output: weatherApprovalFlow.toolOutput,
      approval: { id: weatherApprovalFlow.approvalId, approved: true },
    } as never,
    {
      type: "reasoning",
      text: weatherApprovalFlow.finalReasoning,
      state: "done",
    },
    {
      type: "text",
      text: weatherApprovalFlow.finalText,
      state: "streaming",
    },
  ];
}
