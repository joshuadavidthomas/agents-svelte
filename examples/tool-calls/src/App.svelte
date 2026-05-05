<script lang="ts">
  import { createAgent } from "@joshthomas/cloudflare-agents-svelte";
  import { createAgentChat, type ClientToolSchema } from "@joshthomas/cloudflare-agents-svelte/chat";
  import type { UIMessage } from "ai";

  type ToolDefinition = ClientToolSchema & {
    label: string;
    execute: () => unknown | Promise<unknown>;
  };

  type UsageMetadata = {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };

  const tools: ToolDefinition[] = [
    {
      name: "getPageTitle",
      label: "getPageTitle",
      description: "Get the current browser page title.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ title: document.title }),
    },
    {
      name: "getCurrentTime",
      label: "getCurrentTime",
      description: "Get the user's current local time and time zone.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ now: new Date().toLocaleString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    },
    {
      name: "getScreenInfo",
      label: "getScreenInfo",
      description: "Get the user's screen and viewport size.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ screen: { width: screen.width, height: screen.height }, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio }),
    },
    {
      name: "getColorScheme",
      label: "getColorScheme",
      description: "Detect whether the user prefers a light or dark color scheme.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" }),
    },
  ];

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

  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const agent = createAgent({ agent: "DynamicToolsAgent", name: "tool-calls" });
  let enabledTools = $state(new Set(tools.slice(0, 4).map((tool) => tool.name)));
  let input = $state("");
  let scrollContainer = $state<HTMLElement>();
  let usage = $state({ ...emptyUsage });
  let wasStreaming = $state(false);

  const activeTools = $derived(
    tools
      .filter((tool) => enabledTools.has(tool.name))
      .map(({ name, description, parameters }) => ({ name, description, parameters }))
  );

  const chat = createAgentChat({
    agent,
    body: () => ({ clientTools: activeTools }),
    autoContinueAfterToolResult: false,
    sendAutomaticallyWhen: ({ messages }) => latestAssistantToolCallsResolved(messages),
  });

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

  $effect(() => {
    for (const toolCall of chat.pendingToolCalls) {
      if (toolCall.handled || toolCall.running) continue;
      const tool = toolByName.get(toolCall.toolName);
      if (!tool || !enabledTools.has(tool.name)) {
        toolCall.addOutput({ state: "output-error", errorText: `Tool ${toolCall.toolName} is not enabled.` });
        continue;
      }
      void toolCall.run(() => tool.execute());
    }
  });

  $effect(() => {
    void chat.messages.length;
    void chat.isStreaming;
    requestAnimationFrame(() => {
      scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight });
    });
  });

  function toggleTool(name: string) {
    const next = new Set(enabledTools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    enabledTools = next;
  }

  function send() {
    const text = input.trim();
    if (!text || chat.isStreaming) return;
    chat.sendMessage({ text });
    input = "";
  }

  function startNewChat() {
    chat.clearHistory();
    usage = { ...emptyUsage };
    wasStreaming = false;
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
          .map((part) => partText(part) || reasoningText(part))
          .join("\n"),
      );

      if (message.role === "user") estimatedInputTokens += estimatedTokens;
      else if (message.role === "assistant") estimatedOutputTokens += estimatedTokens;
    }

    const hasReportedUsage = reportedInputTokens > 0 || reportedOutputTokens > 0;
    const inputTokens = hasReportedUsage ? reportedInputTokens : estimatedInputTokens;
    const outputTokens = hasReportedUsage ? reportedOutputTokens : estimatedOutputTokens;
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

  function latestAssistantToolCallsResolved(messages: UIMessage[]): boolean {
    const last = messages.at(-1);
    if (!last || last.role !== "assistant") return false;
    const toolParts = last.parts.filter((part) => part.type.startsWith("tool-"));
    return toolParts.length > 0 && toolParts.every((part) => {
      const state = toolState(part);
      return state === "output-available" || state === "output-error";
    });
  }

  function partText(part: unknown): string {
    return typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : "";
  }

  function reasoningText(part: unknown): string {
    return typeof part === "object" && part !== null && "type" in part && part.type === "reasoning" && "text" in part
      ? String(part.text ?? "")
      : "";
  }

  function toolName(part: unknown): string {
    if (typeof part !== "object" || part === null) return "tool";
    if ("toolName" in part) return String(part.toolName);
    if ("type" in part) return String(part.type).replace(/^tool-/, "");
    return "tool";
  }

  function toolState(part: unknown): string {
    return typeof part === "object" && part !== null && "state" in part ? String(part.state) : "";
  }

  function toolOutput(part: unknown): unknown {
    return typeof part === "object" && part !== null && "output" in part ? part.output : undefined;
  }

  function toolError(part: unknown): string | undefined {
    return typeof part === "object" && part !== null && "errorText" in part ? String(part.errorText) : undefined;
  }
</script>

<svelte:head>
  <title>Dynamic Tools</title>
</svelte:head>

<div class="app">
  <header class="header">
    <div class="header-inner">
      <div class="title-row">
        <h1>Dynamic Tools</h1>
        <span class="badge">Svelte</span>
      </div>
      <div class="header-actions">
        <div class="status" class:connected={agent.connected}>{agent.connected ? "Connected" : "Connecting"}</div>
        <button class="top-button" type="button" onclick={startNewChat}>Clear</button>
      </div>
    </div>
  </header>

  <main class="layout">
    <aside class="tools">
      <section class="info-card">
        <h2>Dynamic Tool Registration</h2>
        <p>Toggle tools on/off to simulate an SDK where third-party developers register tools at runtime.</p>
      </section>

      <h3>Available Tools</h3>

      <div class="tool-list">
        {#each tools as tool}
          <button class:enabled={enabledTools.has(tool.name)} class="tool-toggle" type="button" onclick={() => toggleTool(tool.name)}>
            <span>
              <strong>{tool.label}</strong>
              <small>{tool.description}</small>
            </span>
            <i aria-hidden="true"><span></span></i>
          </button>
        {/each}
      </div>

      <p class="count">{activeTools.length} of {tools.length} tools active</p>

      <footer class="sidebar-footer">
        <div class="usage-group">
          <code>{MODEL_ID}</code>
          <div class="usage-meta" title="Gemma 4 cost estimate at $0.10/M input and $0.30/M output tokens">
            <span>{usage.inputTokens.toLocaleString()} in</span>
            <span>{usage.outputTokens.toLocaleString()} out</span>
            <strong>{formattedCost}</strong>
            {#if usage.estimated}<em>est.</em>{/if}
          </div>
        </div>
        <div class="route-meta">
          <span>{chat.status === "submitted" ? "Thinking" : chat.isStreaming ? "Streaming" : "Idle"}</span>
        </div>
      </footer>
    </aside>

    <section class="chat">
      <div bind:this={scrollContainer} class="messages">
        {#if chat.messages.length === 0}
          <div class="empty">
            <h2>Dynamic tools are ready</h2>
            <p>Try asking what page you are on, what time it is, or what your screen size is.</p>
          </div>
        {/if}

        {#each chat.messages as message (message.id)}
          <article class:user={message.role === "user"} class="message">
            <div class="bubble">
              {#each message.parts as part}
                {#if part.type === "text"}
                  <p>{part.text}</p>
                {:else if part.type === "reasoning" && partText(part).trim()}
                  <details class="reasoning">
                    <summary>Thinking</summary>
                    <p>{partText(part)}</p>
                  </details>
                {:else if part.type.startsWith("tool-")}
                  <div class="tool-card">
                    <div class="tool-card-header">
                      <strong>{toolName(part)}</strong>
                      <span>{toolState(part) === "output-available" ? "Done" : toolState(part) === "output-error" ? "Error" : "Running"}</span>
                    </div>
                    {#if toolState(part) === "output-error"}
                      <pre>{toolError(part)}</pre>
                    {:else if toolState(part) === "output-available"}
                      <pre>{JSON.stringify(toolOutput(part), null, 2)}</pre>
                    {:else if "input" in part}
                      <pre>{JSON.stringify(part.input, null, 2)}</pre>
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
      </div>

      <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea
          bind:value={input}
          disabled={!agent.connected || chat.isStreaming}
          placeholder={activeTools.length ? "Ask the agent to use a browser tool..." : "Enable a tool to try dynamic tool calls..."}
          rows="1"
          onkeydown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        ></textarea>
        <button disabled={!input.trim() || !agent.connected || chat.isStreaming} type="submit">Send</button>

      </form>
    </section>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    color: #111827;
    background: #f3f4f6;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .header {
    border-bottom: 1px solid #e5e7eb;
    padding: 0.875rem 1.25rem;
    background: #ffffff;
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    max-width: 72rem;
    margin: 0 auto;
  }

  .title-row,
  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .header-actions {
    justify-content: flex-end;
  }

  .badge {
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 0.125rem 0.5rem;
    color: #6b7280;
    background: #f9fafb;
    font-size: 0.6875rem;
    font-weight: 650;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 0.9375rem;
  }

  h3 {
    margin: 1.25rem 0 0.625rem;
    font-size: 0.8125rem;
    font-weight: 650;
  }

  .tools p,
  .count {
    margin-top: 0.25rem;
    color: #6b7280;
    font-size: 0.75rem;
  }

  .status {
    color: #92400e;
    font-size: 0.8125rem;
    font-weight: 650;
  }

  .status.connected {
    color: #047857;
  }

  .sidebar-footer {
    display: grid;
    gap: 0.5rem;
    margin-top: auto;
    border-top: 1px solid #e5e7eb;
    padding-top: 0.875rem;
  }

  .usage-group {
    display: grid;
    gap: 0.125rem;
  }

  .usage-group code {
    color: #374151;
    font-size: 0.75rem;
  }

  .usage-meta,
  .route-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: #6b7280;
    font-size: 0.75rem;
  }

  .usage-meta strong {
    color: #374151;
  }

  .usage-meta em {
    font-style: normal;
  }

  .layout {
    display: grid;
    grid-template-columns: 18rem 1fr;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .tools {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid #e5e7eb;
    padding: 1rem;
    background: #ffffff;
  }

  .info-card {
    border: 1px solid #e5e7eb;
    border-radius: 0.875rem;
    padding: 0.875rem;
    background: #ffffff;
  }

  .info-card h2 {
    font-size: 0.8125rem;
  }

  .tool-list {
    display: grid;
    gap: 0.5rem;
  }

  .tool-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid #111827;
    border-radius: 0.5rem;
    padding: 0.625rem;
    color: #374151;
    background: #ffffff;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .tool-toggle span {
    display: grid;
    gap: 0.25rem;
  }

  .tool-toggle strong {
    color: #111827;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .tool-toggle small {
    color: #6b7280;
    font-size: 0.6875rem;
  }

  .tool-toggle i {
    position: relative;
    flex: 0 0 auto;
    width: 1.375rem;
    height: 0.75rem;
    border-radius: 999px;
    background: #d1d5db;
  }

  .tool-toggle i span {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: #ffffff;
    transition: transform 120ms ease;
  }

  .tool-toggle.enabled i {
    background: #111827;
  }

  .tool-toggle.enabled i span {
    transform: translateX(0.625rem);
  }

  .chat {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .messages {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 2rem 1.25rem 6.5rem;
  }

  .empty {
    margin: 4rem auto;
    max-width: 32rem;
    color: #6b7280;
    text-align: center;
  }

  .empty h2 {
    margin-bottom: 0.5rem;
    color: #111827;
  }

  .message {
    display: flex;
    margin: 0 auto 1rem;
    max-width: 48rem;
  }

  .message.user {
    justify-content: flex-end;
  }

  .bubble {
    width: min(100%, 38rem);
    border: 1px solid #e5e7eb;
    border-radius: 1rem;
    border-bottom-left-radius: 0.25rem;
    padding: 0.875rem 1rem;
    background: #ffffff;
  }

  .user .bubble {
    border-color: #111827;
    border-bottom-right-radius: 0.25rem;
    border-bottom-left-radius: 1rem;
    color: #ffffff;
    background: #111827;
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

  .tool-card pre {
    overflow-x: auto;
    margin: 0.5rem 0 0;
    white-space: pre-wrap;
  }

  .tool-card {
    margin-top: 0.75rem;
    border: 1px solid #dbeafe;
    border-radius: 0.75rem;
    padding: 0.75rem;
    color: #1e3a8a;
    background: #eff6ff;
    font-size: 0.8125rem;
  }

  .tool-card-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .tool-card-header span {
    font-weight: 750;
    text-transform: uppercase;
  }

  .cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1rem;
    margin-left: 0.125rem;
    vertical-align: -0.125rem;
    background: currentColor;
    animation: blink 1s steps(1) infinite;
  }

  .composer {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    gap: 0.625rem;
    border-top: 1px solid #e5e7eb;
    padding: 1rem 1.25rem;
    background: #ffffff;
  }

  textarea {
    flex: 1;
    resize: none;
    border: 1px solid #d1d5db;
    border-radius: 0.875rem;
    padding: 0.75rem 0.875rem;
    font: inherit;
  }

  button {
    border: 0;
    border-radius: 0.875rem;
    padding: 0.75rem 1rem;
    color: #ffffff;
    background: #111827;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }

  button:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .top-button {
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: #374151;
    background: #ffffff;
    font-size: 0.8125rem;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  @media (max-width: 760px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .tools {
      max-height: 40vh;
      border-right: 0;
      border-bottom: 1px solid #e5e7eb;
    }
  }
</style>
