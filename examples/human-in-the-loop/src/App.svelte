<script lang="ts">
  import { tick } from "svelte";
  import { getToolName, isToolUIPart, type UIMessage } from "ai";
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";
  import ExampleChrome from "../../_shared/ExampleChrome.svelte";
  import ExampleUsage from "../../_shared/ExampleUsage.svelte";
  import LiveStatus from "../../_shared/LiveStatus.svelte";
  import { calculateTokenUsage } from "../../_shared/usage";

  const MODEL_ID = "@cf/moonshotai/kimi-k2.6";
  const MODEL_INPUT_COST_PER_MILLION = 0.5;
  const MODEL_OUTPUT_COST_PER_MILLION = 3;

  const agent = createAgent({ agent: "ChatAgent", name: "human-in-the-loop" });
  const chat = createAgentChat({ agent });

  let input = $state("");
  let scrollContainer = $state<HTMLElement>();

  type MessagePart = UIMessage["parts"][number];
  type ToolPart = Extract<MessagePart, { toolCallId: string }>;
  const usage = $derived(
    calculateTokenUsage(chat.messages, {
      inputCostPerMillion: MODEL_INPUT_COST_PER_MILLION,
      outputCostPerMillion: MODEL_OUTPUT_COST_PER_MILLION,
    }),
  );

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

  const awaitingResponse = $derived(chat.activity.kind === "submitted");
  const showStreamingCursor = $derived(
    chat.activity.kind === "streaming" || chat.activity.kind === "tool-continuation",
  );

  const status = $derived(activityLabel(chat.activity.kind, pendingApproval));

  function activityLabel(kind: string, hasPendingApproval: boolean): string {
    switch (kind) {
      case "submitted":
        return "Thinking";
      case "streaming":
        return "Streaming";
      case "recovering":
        return "Recovering";
      case "tool-continuation":
        return "Continuing";
      case "awaiting-tools":
        return "Waiting for tools";
      default:
        return hasPendingApproval ? "Waiting for approval" : "Idle";
    }
  }

  $effect(() => {
    for (const toolCall of chat.pendingToolCalls) {
      if (toolCall.toolName === "getLocalTime") {
        void toolCall.run(async (input) => executeGetLocalTime(input));
      }
    }
  });

  $effect(() => {
    void chat.messages.length;
    void chat.activity.kind;
    void awaitingResponse;

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
    if (!text || chat.isBusy || pendingApproval) return;

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
  <title>Human in the Loop · agents-svelte</title>
</svelte:head>

<ExampleChrome
  title="Human in the Loop"
  connected={agent.connected}
  connectionText={agent.connected ? "Connected" : "Connecting"}
  actionLabel="Clear"
  actionDisabled={chat.messages.length === 0 || chat.isBusy}
  onAction={startNewChat}
>
  {#snippet subbar()}
    <ExampleUsage
      title="Human-in-the-loop tools"
      description="Approve or reject sensitive tool calls before they run."
      modelId={MODEL_ID}
      {usage}
      costTitle="Kimi K2.6 cost estimate at $0.50/M input and $3.00/M output tokens"
      {status}
    />
  {/snippet}

  <LiveStatus message={status} />

  <main bind:this={scrollContainer} class="messages">
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
              {#if showStreamingCursor && message === chat.messages.at(-1) && message.role === "assistant"}
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

  {#snippet composer()}
    <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea
        bind:value={input}
        disabled={!agent.connected || pendingApproval}
        rows="1"
        placeholder={pendingApproval ? "Approve or reject the tool call to continue..." : "Say something..."}
        aria-label="Message"
        onkeydown={(event) => {
          if (event.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>

      <button disabled={!agent.connected || !input.trim() || chat.isBusy || pendingApproval} type="submit">Send</button>
    </form>
  {/snippet}
</ExampleChrome>

<style>
  h2, p { margin: 0; }
  .button-row { display: flex; align-items: center; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; }
  .messages-inner { width: min(100%, 768px); min-height: 100%; margin: 0 auto; padding: 1.5rem 1.25rem; }
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
  .composer { display: flex; align-items: flex-end; gap: 0.75rem; padding: 1rem 1.25rem; }
  textarea { flex: 1; min-height: 2.75rem; max-height: 10rem; resize: vertical; border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.75rem 0.875rem; color: #111827; background: #fff; box-shadow: 0 1px 2px rgb(15 23 42 / 4%); font: inherit; line-height: 1.4; outline: none; }
  textarea:focus { border-color: transparent; box-shadow: 0 0 0 2px #93c5fd, 0 1px 2px rgb(15 23 42 / 4%); }
  button { flex: none; border: 0; border-radius: 0.875rem; padding: 0.75rem 1rem; color: #fff; background: #111827; font: inherit; font-weight: 650; cursor: pointer; }
  button.secondary { border: 1px solid #e5e7eb; color: #111827; background: #fff; }
  button:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.55; }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes pulse { 0%, 80%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-0.125rem); } }
</style>
