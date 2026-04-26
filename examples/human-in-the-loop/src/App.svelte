<script lang="ts">
  import { tick } from "svelte";
  import { getToolName, isToolUIPart, type UIMessage } from "ai";
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat } from "@joshthomas/cloudflare-agents-svelte/chat";

  const MODEL_ID = "@cf/moonshotai/kimi-k2.6";
  const MODEL_INPUT_COST_PER_MILLION = 0.5;
  const MODEL_OUTPUT_COST_PER_MILLION = 3;

  const agent = createAgent({ agent: "ChatAgent", name: "human-in-the-loop" });
  const chat = createAgentChat({ agent });

  let input = $state("");
  let scrollContainer = $state<HTMLElement>();

  type MessagePart = UIMessage["parts"][number];
  type ToolPart = Extract<MessagePart, { toolCallId: string }>;
  type UsageMetadata = {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };

  const usage = $derived.by(calculateUsage);

  const pendingApproval = $derived(
    chat.messages.some((message) =>
      message.parts.some(
        (part) =>
          isToolUIPart(part) &&
          "approval" in part &&
          part.state === "approval-requested" &&
          Boolean(part.approval?.id),
      ),
    ),
  );

  const awaitingResponse = $derived(chat.status === "submitted");

  const status = $derived(
    awaitingResponse
      ? "Thinking"
      : chat.isStreaming
        ? "Streaming"
        : pendingApproval
          ? "Waiting for approval"
          : "Idle",
  );

  const formattedCost = $derived(
    usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`,
  );

  $effect(() => {
    for (const toolCall of chat.pendingToolCalls) {
      if (toolCall.toolName === "getLocalTime") {
        void toolCall.run(async (input) => executeGetLocalTime(input));
      }
    }
  });

  $effect(() => {
    chat.messages.length;
    chat.isStreaming;
    awaitingResponse;

    tick().then(() => {
      if (!scrollContainer) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });
  });

  async function executeGetLocalTime(input: unknown) {
    const location =
      typeof input === "object" && input !== null && "location" in input
        ? String(input.location)
        : "your location";
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return `The local time in ${location} is ${new Date().toLocaleTimeString()}.`;
  }

  function send() {
    const text = input.trim();
    if (!text || chat.isStreaming || pendingApproval) return;

    chat.sendMessage({ text });
    input = "";
  }

  function approve(part: ToolPart) {
    const approvalId = approvalIdFor(part);
    if (!approvalId) return;
    chat.addToolApprovalResponse({ id: approvalId, approved: true });
  }

  function reject(part: ToolPart) {
    const approvalId = approvalIdFor(part);
    if (!approvalId) return;
    chat.addToolApprovalResponse({ id: approvalId, approved: false });
  }

  function startNewChat() {
    chat.clearHistory();
  }

  function calculateUsage() {
    let reportedInputTokens = 0;
    let reportedOutputTokens = 0;
    let estimatedInputTokens = 0;
    let estimatedOutputTokens = 0;

    for (const message of chat.messages) {
      const metadata = message.metadata as UsageMetadata | undefined;
      reportedInputTokens += metadata?.usage?.inputTokens ?? 0;
      reportedOutputTokens += metadata?.usage?.outputTokens ?? 0;

      const estimatedTokens = estimateTokens(
        message.parts
          .map((part) => textFromPart(part) || reasoningFromPart(part))
          .join("\n"),
      );

      if (message.role === "user") {
        estimatedInputTokens += estimatedTokens;
      } else if (message.role === "assistant") {
        estimatedOutputTokens += estimatedTokens;
      }
    }

    const hasReportedUsage = reportedInputTokens > 0 || reportedOutputTokens > 0;
    const inputTokens = hasReportedUsage
      ? reportedInputTokens
      : estimatedInputTokens;
    const outputTokens = hasReportedUsage
      ? reportedOutputTokens
      : estimatedOutputTokens;
    const cost =
      (inputTokens / 1_000_000) * MODEL_INPUT_COST_PER_MILLION +
      (outputTokens / 1_000_000) * MODEL_OUTPUT_COST_PER_MILLION;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost,
      estimated: !hasReportedUsage,
    };
  }

  function estimateTokens(text: string): number {
    if (!text.trim()) return 0;
    return Math.ceil(text.length / 4);
  }

  function textFromPart(part: MessagePart): string {
    return part.type === "text" ? (part.text ?? "") : "";
  }

  function reasoningFromPart(part: MessagePart): string {
    return part.type === "reasoning" ? (part.text ?? "") : "";
  }

  function isApprovalRequested(part: MessagePart): part is ToolPart & { approval: { id: string } } {
    return isToolUIPart(part) && "approval" in part && part.state === "approval-requested" && Boolean(part.approval?.id);
  }

  function approvalIdFor(part: ToolPart): string | undefined {
    return "approval" in part ? part.approval?.id : undefined;
  }

  function toolOutput(part: ToolPart): unknown {
    return "output" in part ? part.output : undefined;
  }

  function toolError(part: ToolPart): string | undefined {
    return "errorText" in part ? part.errorText : undefined;
  }

  function toolState(part: ToolPart): string {
    switch (part.state) {
      case "input-streaming":
        return "Preparing";
      case "input-available":
        return "Running";
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

<svelte:head>
  <title>Human in the Loop · cloudflare-agents-svelte</title>
</svelte:head>

<div class="shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="title-row">
        <h1>Human in the Loop</h1>
        <div class="badge">Svelte</div>
      </div>

      <div class="header-actions">
        <div class:online={agent.connected} class="connection">
          <span></span>
          {agent.connected ? "Connected" : "Connecting"}
        </div>
        <button class="ghost" type="button" disabled={chat.messages.length === 0 || chat.isStreaming} onclick={startNewChat}>
          Clear
        </button>
      </div>
    </div>
  </header>

  <div class="subbar">
    <div class="subbar-inner">
      <div>
        <h2>Human-in-the-loop tools</h2>
        <p>Approve or reject sensitive tool calls before they run.</p>
      </div>
      <div class="usage-group">
        <code>{MODEL_ID}</code>
        <div class="usage-meta" title="Kimi K2.6 cost estimate at $0.50/M input and $3.00/M output tokens">
          <span>{usage.inputTokens.toLocaleString()} in</span>
          <span>{usage.outputTokens.toLocaleString()} out</span>
          <strong>{formattedCost}</strong>
          {#if usage.estimated}<em>est.</em>{/if}
          <span>{status}</span>
        </div>
      </div>
    </div>
  </div>

  <main bind:this={scrollContainer} class="messages" aria-live="polite">
    <div class="messages-inner">
      {#if chat.messages.length === 0}
        <div class="empty">
          <div class="empty-icon">✓</div>
          <h2>Try a tool that needs approval</h2>
          <p>Ask about the weather to approve or reject a server-side tool. Ask for local time to run a browser-side tool. Ask for local news to run an automatic server tool.</p>
        </div>
      {:else}
        {#each chat.messages as message (message.id)}
          <article class:user={message.role === "user"} class="message">
            <div class="bubble">
              {#each message.parts as part}
                {@const text = textFromPart(part)}
                {@const reasoning = reasoningFromPart(part)}
                {#if text}
                  <p>{text}</p>
                {:else if reasoning}
                  <details class="reasoning">
                    <summary>Thinking</summary>
                    <p>{reasoning}</p>
                  </details>
                {:else if isToolUIPart(part)}
                  <div class:approval={isApprovalRequested(part)} class="tool-card">
                    <div class="tool-card-header">
                      <strong>{getToolName(part)}</strong>
                      <span>{toolState(part)}</span>
                    </div>

                    {#if isApprovalRequested(part)}
                      <p>Run <span>{getToolName(part)}</span> with args: <code>{JSON.stringify(part.input)}</code></p>
                      <div class="button-row">
                        <button type="button" onclick={() => approve(part)}>Approve</button>
                        <button class="secondary" type="button" onclick={() => reject(part)}>Reject</button>
                      </div>
                    {:else if toolOutput(part) !== undefined}
                      <pre>{JSON.stringify(toolOutput(part), null, 2)}</pre>
                    {:else if toolError(part)}
                      <p class="tool-error">{toolError(part)}</p>
                    {/if}
                  </div>
                {/if}
              {/each}
              {#if chat.isStreaming && message === chat.messages.at(-1) && message.role === "assistant"}
                <span class="cursor"></span>
              {/if}
            </div>
          </article>
        {/each}
      {/if}

      {#if awaitingResponse}
        <article class="message">
          <div class="bubble loading" aria-label="Assistant is thinking">
            <span></span><span></span><span></span>
          </div>
        </article>
      {/if}

      {#if chat.error}
        <div class="error" role="alert">{chat.error.message}</div>
      {/if}
    </div>
  </main>

  <footer class="composer-wrap">
    <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea
        bind:value={input}
        disabled={!agent.connected || pendingApproval}
        rows="1"
        placeholder={pendingApproval ? "Approve or reject the tool call to continue..." : "Say something..."}
        aria-label="Message"
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>

      <button disabled={!agent.connected || !input.trim() || chat.isStreaming || pendingApproval} type="submit">Send</button>
    </form>
  </footer>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; }
  :global(body) { color: #111827; background: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .shell { display: flex; flex-direction: column; height: 100vh; background: #f8fafc; }
  .topbar { flex: none; border-bottom: 1px solid #e5e7eb; background: #fff; }
  .topbar-inner, .subbar-inner, .messages-inner, .composer { width: min(100%, 768px); margin: 0 auto; }
  .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
  h2 { margin-bottom: 0.25rem; font-size: 0.875rem; }
  .title-row, .header-actions, .connection, .usage-meta, .button-row { display: flex; align-items: center; }
  .title-row { gap: 0.75rem; }
  .header-actions { gap: 0.75rem; }
  .badge { border: 1px solid #e5e7eb; border-radius: 999px; padding: 0.2rem 0.5rem; color: #4b5563; background: #f9fafb; font-size: 0.75rem; font-weight: 650; }
  .connection { gap: 0.45rem; color: #6b7280; font-size: 0.75rem; font-weight: 600; }
  .connection span { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #f59e0b; }
  .connection.online span { background: #10b981; }
  .subbar { flex: none; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
  .subbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.25rem; }
  .subbar p, .subbar span, .usage-meta { color: #6b7280; font-size: 0.75rem; }
  .usage-group { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; }
  .usage-group code { overflow: hidden; max-width: 18rem; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
  .usage-meta { flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; white-space: nowrap; }
  .usage-meta strong { color: #111827; font-size: 0.75rem; }
  .usage-meta em { color: #9ca3af; font-style: normal; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; }
  .messages-inner { min-height: 100%; padding: 1.5rem 1.25rem; }
  .empty { display: grid; min-height: 50vh; place-content: center; justify-items: center; color: #6b7280; text-align: center; }
  .empty-icon { display: grid; width: 2.5rem; height: 2.5rem; place-items: center; margin-bottom: 1rem; border: 1px solid #e5e7eb; border-radius: 999px; color: #2563eb; background: #fff; box-shadow: 0 8px 24px rgb(15 23 42 / 6%); }
  .empty h2 { margin-bottom: 0.5rem; color: #111827; font-size: 1.25rem; }
  .empty p { max-width: 36rem; line-height: 1.6; }
  .message { display: flex; margin-bottom: 1rem; }
  .message.user { justify-content: flex-end; }
  .bubble { width: min(85vw, 42rem); border: 1px solid #e5e7eb; border-radius: 1rem 1rem 1rem 0.25rem; padding: 0.75rem 1rem; color: #111827; background: #fff; line-height: 1.6; box-shadow: 0 1px 2px rgb(15 23 42 / 4%); }
  .user .bubble { border-color: #111827; border-bottom-right-radius: 0.25rem; border-bottom-left-radius: 1rem; color: #fff; background: #111827; }
  .bubble p + p { margin-top: 0.75rem; }
  .loading { display: flex; width: fit-content; gap: 0.35rem; }
  .loading span { width: 0.45rem; height: 0.45rem; border-radius: 999px; background: #93c5fd; animation: pulse 1s ease-in-out infinite; }
  .loading span:nth-child(2) { animation-delay: 0.12s; }
  .loading span:nth-child(3) { animation-delay: 0.24s; }
  .reasoning { margin-bottom: 0.75rem; border-radius: 0.75rem; padding: 0.625rem 0.75rem; color: #6b7280; background: #f3f4f6; }
  .reasoning summary { color: #4b5563; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
  .reasoning p { margin-top: 0.5rem; font-size: 0.8125rem; font-style: italic; line-height: 1.5; white-space: pre-wrap; }
  .tool-card { display: grid; gap: 0.625rem; margin-top: 0.75rem; border: 1px solid #dbeafe; border-radius: 0.75rem; padding: 0.75rem; color: #1e3a8a; background: #eff6ff; font-size: 0.8125rem; }
  .tool-card.approval { border-color: #fcd34d; color: #92400e; background: #fffbeb; }
  .tool-card-header { display: flex; justify-content: space-between; gap: 1rem; }
  .tool-card-header span { font-weight: 750; text-transform: uppercase; }
  .tool-card code, .tool-card pre { border-radius: 0.5rem; background: rgb(255 255 255 / 70%); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; }
  .tool-card code { padding: 0.125rem 0.25rem; }
  .tool-card pre { overflow-x: auto; margin: 0; padding: 0.625rem; white-space: pre-wrap; }
  .tool-error { color: #b91c1c; }
  .button-row { gap: 0.5rem; }
  .cursor { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -0.15em; background: #2563eb; animation: blink 1s step-end infinite; }
  .error { width: min(85vw, 42rem); margin: 1rem auto 0; border: 1px solid #fecaca; border-radius: 0.75rem; padding: 0.75rem 1rem; color: #991b1b; background: #fef2f2; }
  .composer-wrap { flex: none; border-top: 1px solid #e5e7eb; background: rgb(255 255 255 / 92%); backdrop-filter: blur(10px); }
  .composer { display: flex; align-items: flex-end; gap: 0.75rem; padding: 1rem 1.25rem; }
  textarea { flex: 1; min-height: 2.75rem; max-height: 10rem; resize: vertical; border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.75rem 0.875rem; color: #111827; background: #fff; box-shadow: 0 1px 2px rgb(15 23 42 / 4%); font: inherit; line-height: 1.4; outline: none; }
  textarea:focus { border-color: transparent; box-shadow: 0 0 0 2px #93c5fd, 0 1px 2px rgb(15 23 42 / 4%); }
  button { flex: none; border: 0; border-radius: 0.875rem; padding: 0.75rem 1rem; color: #fff; background: #111827; font: inherit; font-weight: 650; cursor: pointer; }
  button.ghost, button.secondary { border: 1px solid #e5e7eb; color: #111827; background: #fff; }
  button:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.55; }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-0.125rem); } }
</style>
