<script lang="ts">
  import { tick } from "svelte";
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat } from "@joshthomas/cloudflare-agents-svelte/chat";

  const agent = createAgent({ agent: "ChatAgent", name: "basic-chat" });
  const chat = createAgentChat({ agent });

  let input = $state("");
  let scrollContainer = $state<HTMLElement>();
  let cancelledMessageIds = $state<Set<string>>(new Set());

  $effect(() => {
    chat.messages.length;
    chat.isStreaming;

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

  const emptyUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    estimated: true,
  };

  let usage = $state({ ...emptyUsage });

  let wasStreaming = $state(false);

  $effect(() => {
    if (chat.isStreaming) {
      wasStreaming = true;
      return;
    }

    if (wasStreaming) {
      usage = calculateUsage();
      wasStreaming = false;
    }
  });

  const formattedCost = $derived(
    usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`,
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
    usage = { ...emptyUsage };
    wasStreaming = false;
    cancelledMessageIds = new Set();
  }
</script>

<svelte:head>
  <title>AI Chat · cloudflare-agents-svelte</title>
</svelte:head>

<div class="shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="title-row">
        <h1>AI Chat</h1>
        <div class="badge">Svelte</div>
      </div>

      <div class="header-actions">
        <div class:online={agent.connected} class="connection">
          <span></span>
          {agent.connected ? "Connected" : "Connecting"}
        </div>
        <button
          class="ghost"
          type="button"
          disabled={chat.messages.length === 0 || chat.isStreaming}
          onclick={startNewChat}
        >
          New
        </button>
      </div>
    </div>
  </header>

  <div class="subbar">
    <div class="subbar-inner">
      <div class="usage-group">
        <code>{MODEL_ID}</code>
        <div
          class="usage-meta"
          title="Gemma 4 cost estimate at $0.10/M input and $0.30/M output tokens"
        >
          <span>{usage.inputTokens.toLocaleString()} in</span>
          <span>{usage.outputTokens.toLocaleString()} out</span>
          <strong>{formattedCost}</strong>
          {#if usage.estimated}<em>est.</em>{/if}
        </div>
      </div>
      <div class="route-meta">
        <span>{chat.status === "submitted" ? "Thinking" : chat.isStreaming ? "Streaming" : "Idle"}</span>
      </div>
    </div>
  </div>

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

  <footer class="composer-wrap">
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
  </footer>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
  }

  :global(body) {
    color: #111827;
    background: #f8fafc;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #f8fafc;
  }

  .topbar {
    flex: none;
    border-bottom: 1px solid #e5e7eb;
    background: #ffffff;
  }

  .topbar-inner,
  .subbar-inner,
  .messages-inner,
  .composer {
    width: min(100%, 768px);
    margin: 0 auto;
  }

  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .badge {
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    color: #4b5563;
    background: #f9fafb;
    font-size: 0.75rem;
    font-weight: 650;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: #6b7280;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .connection span {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: #f59e0b;
  }

  .connection.online span {
    background: #10b981;
  }

  .subbar {
    flex: none;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }

  .subbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 1.25rem;
  }

  .route-meta,
  .usage-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .subbar span {
    color: #6b7280;
    font-size: 0.75rem;
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
    min-height: 100%;
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

  .composer-wrap {
    flex: none;
    border-top: 1px solid #e5e7eb;
    background: #ffffff;
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

  button.ghost,
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
    .topbar-inner {
      align-items: flex-start;
      flex-direction: column;
    }

    .header-actions,
    .subbar-inner {
      width: 100%;
      justify-content: space-between;
    }

    .subbar-inner {
      align-items: flex-start;
      flex-direction: column;
    }

    .bubble {
      max-width: 92%;
    }
  }
</style>
