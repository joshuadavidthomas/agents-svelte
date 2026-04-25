import type { AgentChat, AgentChatToolCall } from "../chat.svelte.ts";

declare const chat: AgentChat;
declare const toolCall: AgentChatToolCall;

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
