<script lang="ts">
  import { getToolName, isToolUIPart, type UIMessage } from "ai";
  import type { AgentChat } from "../chat.svelte.ts";

  type MessagePart = UIMessage["parts"][number];
  type ToolPart = Extract<MessagePart, { toolCallId: string }>;

  let { chat }: { chat: AgentChat<UIMessage> } = $props();

  function textFromPart(part: MessagePart): string {
    return part.type === "text" ? (part.text ?? "") : "";
  }

  function reasoningFromPart(part: MessagePart): string {
    return part.type === "reasoning" ? (part.text ?? "") : "";
  }

  function toolOutput(part: ToolPart): unknown {
    return "output" in part ? part.output : undefined;
  }

  function toolState(part: ToolPart): string {
    switch (part.state) {
      case "approval-requested":
        return "Approval";
      case "approval-responded":
        return part.approval?.approved ? "Approved" : "Rejected";
      case "output-available":
        return "Done";
      case "output-error":
        return "Error";
      default:
        return part.state;
    }
  }
</script>

<div data-testid="transcript">
  {#each chat.messages as message (message.id)}
    <article data-role={message.role}>
      {#each message.parts as part}
        {@const text = textFromPart(part)}
        {@const reasoning = reasoningFromPart(part)}
        {#if text}
          <p data-testid="text-part">{text}</p>
        {:else if reasoning}
          <details data-testid="reasoning-part" open>
            <summary>Thinking</summary>
            <p>{reasoning}</p>
          </details>
        {:else if isToolUIPart(part)}
          <div data-testid="tool-card">
            <strong>{getToolName(part)}</strong>
            <span>{toolState(part)}</span>
            {#if toolOutput(part) !== undefined}
              <pre>{JSON.stringify(toolOutput(part), null, 2)}</pre>
            {/if}
          </div>
        {/if}
      {/each}
    </article>
  {/each}
</div>
