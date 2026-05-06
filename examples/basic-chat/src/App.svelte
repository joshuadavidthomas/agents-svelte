<script lang="ts">
  import { tick } from "svelte";
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";
  import ExampleChrome from "../../_shared/ExampleChrome.svelte";

  const agent = createAgent({ agent: "ChatAgent", name: "basic-chat" });
  const chat = createAgentChat({ agent });

  let input = $state("");
  let scrollContainer = $state<HTMLElement>();
  let cancelledMessageIds = $state<Set<string>>(new Set());

  $effect(() => {
    void chat.messages.length;
    void chat.isStreaming;

    tick().then(() => {
      if (!scrollContainer) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });
  });

  type MessagePart = { type: string; text?: string };
  type UsageMetadata = {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };

  const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
  const MODEL_INPUT_COST_PER_MILLION = 0.1;
  const MODEL_OUTPUT_COST_PER_MILLION = 0.3;
  const emptyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, estimated: true };

  let completedUsage = $state({ ...emptyUsage });
  let wasStreaming = $state(false);

  $effect(() => {
    if (chat.isStreaming) {
      wasStreaming = true;
      return;
    }

    if (wasStreaming) {
      completedUsage = calculateUsage();
      wasStreaming = false;
    }
  });

  const formattedCost = $derived(
    completedUsage.cost === 0 ? "$0.000000" : `$${completedUsage.cost.toFixed(6)}`,
  );

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

  function send() {
    const text = input.trim();
    if (!text || chat.isStreaming) return;

    chat.sendMessage({ text });
    input = "";
  }

  function stop() {
    const lastMessage = chat.messages.at(-1);
    if (lastMessage?.role === "assistant") {
      cancelledMessageIds = new Set(cancelledMessageIds).add(lastMessage.id);
    }
    chat.stop();
  }

  function startNewChat() {
    chat.clearHistory();
    completedUsage = { ...emptyUsage };
    wasStreaming = false;
    cancelledMessageIds = new Set();
  }
</script>

<svelte:head>
  <title>AI Chat · agents-svelte</title>
</svelte:head>

<ExampleChrome
  title="AI Chat"
  connected={agent.connected}
  connectionText={agent.connected ? "Connected" : "Connecting"}
  actionLabel="New"
  actionDisabled={chat.messages.length === 0 || chat.isStreaming}
  onAction={startNewChat}
>
  {#snippet subbar()}
    <div class="usage-group">
      <code>{MODEL_ID}</code>
      <div class="usage-meta" title="Gemma 4 cost estimate at $0.10/M input and $0.30/M output tokens">
        <span>{completedUsage.inputTokens.toLocaleString()} in</span>
        <span>{completedUsage.outputTokens.toLocaleString()} out</span>
        <strong>{formattedCost}</strong>
        {#if completedUsage.estimated}<em>est.</em>{/if}
      </div>
    </div>
    <div class="route-meta">
      <span>{chat.status === "submitted" ? "Thinking" : chat.isStreaming ? "Streaming" : "Idle"}</span>
    </div>
  {/snippet}

  <main bind:this={scrollContainer} class="messages" aria-live="polite">
    <div class="messages-inner">
      {#if chat.messages.length === 0}
        <div class="empty">
          <div class="empty-icon">✦</div>
          <h2>Start a conversation</h2>
          <p>
            Ask a question, watch the response stream in, or try the Stop button
            while the agent is answering.
          </p>
        </div>
      {:else}
        {#each chat.messages as message (message.id)}
          <article class:user={message.role === "user"} class="message">
            <div class:cancelled={cancelledMessageIds.has(message.id)} class="bubble">
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
                {:else if part.type !== "reasoning" && part.type !== "step-start"}
                  <div class="part-label">{part.type}</div>
                {/if}
              {/each}
              {#if cancelledMessageIds.has(message.id)}
                <div class="cancelled-note">Response stopped.</div>
              {:else if chat.isStreaming && message === chat.messages.at(-1) && message.role === "assistant"}
                <span class="cursor"></span>
              {/if}
            </div>
          </article>
        {/each}
      {/if}

      {#if chat.error}
        <div class="error" role="alert">{chat.error.message}</div>
      {/if}
    </div>
  </main>

  {#snippet composer()}
    <form
      class="composer"
      onsubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        bind:value={input}
        disabled={!agent.connected}
        rows="1"
        placeholder="Ask anything..."
        aria-label="Message"
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>

      {#if chat.isStreaming}
        <button class="secondary" type="button" onclick={stop}>Stop</button>
      {:else}
        <button disabled={!agent.connected || !input.trim()}>Send</button>
      {/if}
    </form>
  {/snippet}
</ExampleChrome>

<style>
  h2,
  p {
    margin: 0;
  }

  .route-meta,
  .usage-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .usage-meta span + span::before,
  .usage-meta strong::before {
    content: "·";
    margin-right: 0.5rem;
    color: #d1d5db;
  }

  .usage-group {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .usage-group code {
    overflow: hidden;
    max-width: 18rem;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-meta {
    color: #6b7280;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .usage-meta em {
    color: #9ca3af;
    font-style: normal;
  }

  .usage-meta em::before {
    content: "·";
    margin-right: 0.5rem;
    color: #d1d5db;
  }

  .usage-meta strong {
    color: #111827;
    font-size: 0.75rem;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .messages-inner {
    width: min(100%, 768px);
    min-height: 100%;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }

  .empty {
    display: grid;
    min-height: 50vh;
    place-content: center;
    justify-items: center;
    color: #6b7280;
    text-align: center;
  }

  .empty-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    margin-bottom: 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    color: #2563eb;
    background: #ffffff;
    box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
  }

  .empty h2 {
    margin-bottom: 0.5rem;
    color: #111827;
    font-size: 1.25rem;
  }

  .empty p {
    max-width: 34rem;
    line-height: 1.6;
  }

  .message {
    display: flex;
    margin-bottom: 1rem;
  }

  .message.user {
    justify-content: flex-end;
  }

  .bubble {
    width: min(85vw, 42rem);
    border: 1px solid #e5e7eb;
    border-radius: 1rem 1rem 1rem 0.25rem;
    padding: 0.75rem 1rem;
    color: #111827;
    background: #ffffff;
    line-height: 1.6;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  }

  .user .bubble {
    border-color: #111827;
    border-bottom-right-radius: 0.25rem;
    border-bottom-left-radius: 1rem;
    color: #ffffff;
    background: #111827;
  }

  .cancelled-note {
    margin-top: 0.75rem;
    color: #dc2626;
    font-size: 0.6875rem;
    font-weight: 750;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
  }

  .bubble p + p {
    margin-top: 0.75rem;
  }

  .reasoning {
    margin-bottom: 0.75rem;
    border-radius: 0.75rem;
    padding: 0.625rem 0.75rem;
    color: #6b7280;
    background: #f3f4f6;
  }

  .reasoning summary {
    color: #4b5563;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }

  .reasoning p {
    margin-top: 0.5rem;
    font-size: 0.8125rem;
    font-style: italic;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .part-label {
    border-radius: 0.5rem;
    padding: 0.375rem 0.5rem;
    color: #6b7280;
    background: #f3f4f6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
  }

  .cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    margin-left: 2px;
    vertical-align: -0.15em;
    background: #2563eb;
    animation: blink 1s step-end infinite;
  }

  .error {
    margin-top: 1rem;
    border: 1px solid #fecaca;
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    color: #991b1b;
    background: #fef2f2;
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
  }

  textarea {
    flex: 1;
    min-height: 2.75rem;
    max-height: 10rem;
    resize: vertical;
    border: 1px solid #e5e7eb;
    border-radius: 0.875rem;
    padding: 0.75rem 0.875rem;
    color: #111827;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
    font: inherit;
    line-height: 1.4;
    outline: none;
  }

  textarea:focus {
    border-color: transparent;
    box-shadow:
      0 0 0 2px #93c5fd,
      0 1px 2px rgb(15 23 42 / 4%);
  }

  button {
    flex: none;
    border: 0;
    border-radius: 0.875rem;
    padding: 0.75rem 1rem;
    color: #ffffff;
    background: #111827;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  button.secondary {
    border: 1px solid #e5e7eb;
    color: #111827;
    background: #ffffff;
  }

  button:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }

    50% {
      opacity: 0;
    }
  }

  @media (max-width: 640px) {
    .bubble {
      max-width: 92%;
    }
  }
</style>
