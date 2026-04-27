<script lang="ts">
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat } from "@joshthomas/cloudflare-agents-svelte/chat";

  type PageData = {
    agentHost: string;
    threadId: string;
  };

  type UsageMetadata = {
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };

  let { data }: { data: PageData } = $props();

  const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
  const MODEL_INPUT_COST_PER_MILLION = 0.1;
  const MODEL_OUTPUT_COST_PER_MILLION = 0.3;
  const emptyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, estimated: true };

  // These controllers are intentionally tied to the initial server-loaded thread.
  // They are safe during SSR; the factories connect only after browser mount.
  // svelte-ignore state_referenced_locally
  const agent = createAgent({ agent: "ChatAgent", name: data.threadId, host: data.agentHost });
  const chat = createAgentChat({ agent });

  let input = $state("");
  let usage = $state({ ...emptyUsage });
  let wasStreaming = $state(false);
  let scrollContainer = $state<HTMLElement | null>(null);

  const connectedText = $derived(agent.identity.identified ? "connected" : agent.connected ? "connecting" : "offline");
  const formattedCost = $derived(usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`);
  const scrollTrigger = $derived(`${chat.messages.length}:${chat.isStreaming}`);

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

  $effect(() => {
    if (!scrollTrigger) return;
    requestAnimationFrame(() => scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight }));
  });

  function send() {
    const text = input.trim();
    if (!text || chat.isStreaming) return;
    chat.sendMessage({ text });
    input = "";
  }

  function clear() {
    chat.clearHistory();
    usage = { ...emptyUsage };
    input = "";
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
      const text = message.parts.map((part) => partText(part)).join("\n");
      const tokens = estimateTokens(text);
      if (message.role === "user") estimatedInputTokens += tokens;
      else if (message.role === "assistant") estimatedOutputTokens += tokens;
    }

    const hasReportedUsage = reportedInputTokens > 0 || reportedOutputTokens > 0;
    const inputTokens = hasReportedUsage ? reportedInputTokens : estimatedInputTokens;
    const outputTokens = hasReportedUsage ? reportedOutputTokens : estimatedOutputTokens;
    const cost = (inputTokens / 1_000_000) * MODEL_INPUT_COST_PER_MILLION + (outputTokens / 1_000_000) * MODEL_OUTPUT_COST_PER_MILLION;
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cost, estimated: !hasReportedUsage };
  }

  function estimateTokens(text: string) {
    return text.trim() ? Math.ceil(text.length / 4) : 0;
  }

  function partText(part: unknown): string {
    return typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : "";
  }
</script>

<svelte:head>
  <title>SvelteKit chat · Cloudflare Agents Svelte</title>
  <meta name="description" content="SvelteKit chat example for @joshthomas/cloudflare-agents-svelte" />
</svelte:head>

<main class="app-shell">
  <section class="hero">
    <div>
      <p class="eyebrow">SvelteKit SSR example</p>
      <h1>Chat with a Cloudflare Agent from a server-rendered route.</h1>
      <p class="summary">
        This page is rendered by SvelteKit with SSR enabled. The factories create reactive controllers during component setup, then open the Agent socket after the browser mounts.
      </p>
    </div>
    <dl class="stats">
      <div>
        <dt>status</dt>
        <dd>{connectedText}</dd>
      </div>
      <div>
        <dt>thread</dt>
        <dd>{data.threadId.slice(0, 8)}</dd>
      </div>
      <div>
        <dt>model</dt>
        <dd>{MODEL_ID}</dd>
      </div>
    </dl>
  </section>

  <section class="panel">
    <header class="toolbar">
      <div>
        <h2>Messages</h2>
        <p>{usage.totalTokens} tokens{usage.estimated ? " estimated" : " reported"} · {formattedCost}</p>
      </div>
      <div class="actions">
        {#if chat.isStreaming}
          <button type="button" class="secondary" onclick={() => chat.stop()}>Stop</button>
        {/if}
        <button type="button" class="secondary" onclick={clear}>Start over</button>
      </div>
    </header>

    <div class="subbar">
      <span>{chat.status === "submitted" ? "Thinking" : chat.isStreaming ? "Streaming" : "Idle"}</span>
    </div>

    <div class="transcript" bind:this={scrollContainer}>
      {#if chat.messages.length === 0}
        <div class="empty">
          <p>Ask a question to start streaming a response from the Worker.</p>
        </div>
      {:else}
        {#each chat.messages as message (message.id)}
          <article class:user={message.role === "user"} class="message">
            <div class="bubble">
              {#each message.parts as part}
                {#if part.type === "text"}
                  <p>{part.text}</p>
                {:else if part.type === "reasoning"}
                  <details class="reasoning">
                    <summary>Thinking</summary>
                    <p>{part.text}</p>
                  </details>
                {/if}
              {/each}
              {#if chat.isStreaming && message === chat.messages.at(-1) && message.role === "assistant"}
                <span class="cursor"></span>
              {/if}
            </div>
          </article>
        {/each}
      {/if}
    </div>

    <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
      <input bind:value={input} placeholder="Ask about Cloudflare Agents and SvelteKit" disabled={chat.isStreaming} />
      <button disabled={!input.trim() || chat.isStreaming}>Send</button>
    </form>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #f7f3ec;
    color: #17130f;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button,
  input {
    font: inherit;
  }

  .app-shell {
    box-sizing: border-box;
    display: grid;
    gap: 1.25rem;
    min-height: 100vh;
    padding: clamp(1rem, 3vw, 2rem);
  }

  .hero,
  .panel {
    width: min(100%, 980px);
    margin: 0 auto;
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1.5rem;
    align-items: end;
  }

  .eyebrow {
    margin: 0 0 0.5rem;
    color: #8a4b17;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    max-width: 720px;
    margin-bottom: 0.75rem;
    font-size: clamp(2.1rem, 6vw, 4.5rem);
    line-height: 0.95;
    letter-spacing: -0.07em;
  }

  .summary {
    max-width: 690px;
    margin-bottom: 0;
    color: #675d52;
    font-size: 1.05rem;
    line-height: 1.6;
  }

  .stats {
    display: grid;
    gap: 0.6rem;
    min-width: 220px;
    margin: 0;
  }

  .stats div {
    padding: 0.85rem 1rem;
    border: 1px solid #eadfd1;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.72);
  }

  dt {
    color: #8a8177;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  dd {
    margin: 0.2rem 0 0;
    font-weight: 700;
  }

  .panel {
    display: grid;
    grid-template-rows: auto auto minmax(320px, 1fr) auto;
    min-height: 560px;
    overflow: hidden;
    border: 1px solid #eadfd1;
    border-radius: 1.5rem;
    background: #fffaf4;
    box-shadow: 0 24px 70px rgba(63, 39, 18, 0.12);
  }

  .toolbar,
  .composer {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-color: #eadfd1;
  }

  .toolbar {
    border-bottom: 1px solid #eadfd1;
  }

  .toolbar h2 {
    margin-bottom: 0.25rem;
    font-size: 1rem;
  }

  .toolbar p {
    margin-bottom: 0;
    color: #756a5f;
    font-size: 0.9rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .subbar {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #eadfd1;
    color: #756a5f;
    font-size: 0.8rem;
  }

  .transcript {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    overflow-y: auto;
    padding: 1rem;
  }

  .empty {
    display: grid;
    min-height: 100%;
    place-items: center;
    color: #756a5f;
    text-align: center;
  }

  .message {
    display: flex;
    flex-shrink: 0;
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
    width: auto;
    max-width: min(85vw, 42rem);
    border-color: #111827;
    border-bottom-right-radius: 0.25rem;
    border-bottom-left-radius: 1rem;
    color: #ffffff;
    background: #17130f;
  }

  .bubble p + p {
    margin-top: 0.75rem;
  }

  .bubble p:last-child {
    margin-bottom: 0;
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
  }

  .reasoning p {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    font-style: italic;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  @media (max-width: 760px) {
    .bubble {
      max-width: 92%;
    }
  }

  .composer {
    border-top: 1px solid #eadfd1;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 0.9rem 1rem;
    border: 1px solid #eadfd1;
    border-radius: 999px;
    background: white;
    color: inherit;
  }

  button {
    border: 0;
    border-radius: 999px;
    background: #f48120;
    color: white;
    cursor: pointer;
    font-weight: 800;
    padding: 0.9rem 1.1rem;
  }

  button.secondary {
    border: 1px solid #eadfd1;
    background: white;
    color: #17130f;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
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

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  @media (max-width: 760px) {
    .hero {
      grid-template-columns: 1fr;
    }

    .stats {
      grid-template-columns: 1fr;
    }

    .toolbar,
    .composer {
      align-items: stretch;
      flex-direction: column;
    }

    .actions {
      width: 100%;
    }

    .actions button,
    .composer button {
      width: 100%;
    }
  }
</style>
