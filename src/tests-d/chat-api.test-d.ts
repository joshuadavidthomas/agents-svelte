import type { Agent } from "../agent.svelte.ts";
import type {
  AgentChat,
  AgentChatToolCall,
  AgentToolEvents,
  CreateAgentChatOptions,
} from "../chat.ts";
import { createAgentToolEvents } from "../chat.ts";

declare const agent: Agent;
declare const chat: AgentChat;
declare const toolCall: AgentChatToolCall;
declare const toolEvents: AgentToolEvents;

// @ts-expect-error chat-level tool output is intentionally not public
chat.addToolOutput({ toolCallId: "call", tool: "foo", output: {} });

// @ts-expect-error deprecated chat-level tool result is intentionally not public
chat.addToolResult({ toolCallId: "call", tool: "foo", output: {} });

toolCall.addOutput({ output: { ok: true } });
toolCall.addOutput();
toolCall.addOutput({ state: "output-error", errorText: "failed" });

// @ts-expect-error output-error requires errorText
toolCall.addOutput({ state: "output-error" });

// @ts-expect-error output-error must not include output
toolCall.addOutput({ state: "output-error", errorText: "failed", output: {} });

// @ts-expect-error successful output must not include errorText
toolCall.addOutput({ state: "output-available", errorText: "failed" });

toolEvents.getRunsForToolCall("call");
toolEvents.resetLocalState();
toolEvents.connect();
toolEvents.close();

const createdToolEvents: AgentToolEvents = createAgentToolEvents({ agent });
void createdToolEvents;

const chatWithClientTools: CreateAgentChatOptions = {
  agent,
  clientTools: () => [{ name: "getLocation", parameters: { type: "object" } }],
};
void chatWithClientTools;

const localProjectionChat: CreateAgentChatOptions = {
  agent,
  syncMessagesToServer: false,
};
void localProjectionChat;
