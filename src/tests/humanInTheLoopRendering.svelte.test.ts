import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "vitest-browser-svelte/pure";
import type { UIMessage } from "ai";
import { MessageType } from "@cloudflare/ai-chat/types";
import { AgentChat, type CreateAgentChatOptions } from "../chat.svelte.ts";
import HumanLoopTranscriptHarness from "./HumanLoopTranscriptHarness.svelte";
import { createMockAgent, type MockAgent } from "./mock-agent.ts";
import {
  dispatchStaleWeatherApprovalSync,
  dispatchWeatherApprovalContinuationFinish,
  dispatchWeatherApprovalContinuationStart,
  weatherApprovalFlow,
  weatherApprovalInitialMessages
} from "./human-loop-flow.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanup();
  while (cleanups.length) {
    cleanups.pop()?.();
  }
});

async function waitForChatInitialized(chat: { initialized: boolean }) {
  await vi.waitFor(() => {
    expect(chat.initialized).toBe(true);
  });
}

function findSent(
  mock: MockAgent,
  type: string
): Record<string, unknown> | undefined {
  return mock.sentMessages.find((m) => m.type === type);
}

function makeChat<M extends UIMessage = UIMessage>(
  mock: MockAgent,
  overrides: Partial<CreateAgentChatOptions<M>> = {}
): AgentChat<M> {
  const chat = new AgentChat<M>({
    agent: mock.agent,
    getInitialMessages: null,
    resume: false,
    ...overrides
  });
  cleanups.push(() => chat.close());
  return chat;
}

describe("human-in-the-loop transcript rendering", () => {
  it("keeps final reasoning and text visible after approval continuation sync", async () => {
    const mock = createMockAgent();
    const chat = makeChat(mock, {
      resume: true,
      initialMessages: weatherApprovalInitialMessages()
    });
    await waitForChatInitialized(chat);

    const screen = await render(HumanLoopTranscriptHarness, { chat });

    await expect
      .element(screen.getByText(weatherApprovalFlow.initialReasoning))
      .toBeVisible();
    await expect.element(screen.getByText("Approval")).toBeVisible();

    chat.addToolApprovalResponse({
      id: weatherApprovalFlow.approvalId,
      approved: true
    });
    await vi.waitFor(() => {
      expect(findSent(mock, MessageType.CF_AGENT_TOOL_APPROVAL)).toBeDefined();
      expect(
        findSent(mock, MessageType.CF_AGENT_STREAM_RESUME_REQUEST)
      ).toBeDefined();
    });

    dispatchWeatherApprovalContinuationStart(mock);
    dispatchStaleWeatherApprovalSync(mock);

    await expect
      .element(screen.getByText(weatherApprovalFlow.finalReasoning))
      .toBeVisible();

    dispatchWeatherApprovalContinuationFinish(mock);

    await expect
      .element(screen.getByText(weatherApprovalFlow.initialReasoning))
      .toBeVisible();
    await expect
      .element(screen.getByText(weatherApprovalFlow.finalReasoning))
      .toBeVisible();
    await expect.element(screen.getByText("Done")).toBeVisible();
    await expect
      .element(screen.getByText(JSON.stringify(weatherApprovalFlow.toolOutput)))
      .toBeVisible();
    await expect
      .element(screen.getByText(weatherApprovalFlow.finalText))
      .toBeVisible();

    expect(screen.container.querySelectorAll('[data-testid="reasoning-part"]'))
      .toHaveLength(2);
  });
});
