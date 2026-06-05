<script lang="ts">
  import { tick } from "svelte";
  import { createAgent } from "agents-svelte";
  import { createAgentChat, createAgentToolEvents, type AgentToolRunState } from "agents-svelte/chat";
  import ExampleChrome from "../../_shared/ExampleChrome.svelte";
  import ExampleUsage from "../../_shared/ExampleUsage.svelte";
  import LiveStatus from "../../_shared/LiveStatus.svelte";
  import { calculateTokenUsage } from "../../_shared/usage";

  const agent = createAgent({ agent: "Assistant", name: "demo-user" });
  const chat = createAgentChat({ agent });
  const toolEvents = createAgentToolEvents({ agent });

  const prompts = [
    "Compare Durable Objects and KV for chat history",
    "Research Svelte runes",
    "Plan a refactor for duplicated auth checks",
  ];

  const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
  const MODEL_INPUT_COST_PER_MILLION = 0.1;
  const MODEL_OUTPUT_COST_PER_MILLION = 0.3;

  let input = $state(prompts[0]);
  let scrollContainer = $state<HTMLElement>();
  let openRunIds = $state(new Set<string>());
  const initializedRunIds = new Set<string>();

  const helperRuns = $derived(Object.values(toolEvents.runsById));
  const runCount = $derived(helperRuns.length);
  const activeRunCount = $derived(helperRuns.filter((run) => run.status === "running").length);

  const usage = $derived(
    calculateTokenUsage(chat.messages, {
      inputCostPerMillion: MODEL_INPUT_COST_PER_MILLION,
      outputCostPerMillion: MODEL_OUTPUT_COST_PER_MILLION,
    }),
  );
  const status = $derived(activityLabel(chat.activity.kind));
  const showStreamingCursor = $derived(
    chat.activity.kind === "streaming" || chat.activity.kind === "tool-continuation",
  );
  const helperRunMeta = $derived([
    `${runCount} helper ${runCount === 1 ? "run" : "runs"}`,
    ...(activeRunCount > 0 ? [`${activeRunCount} active`] : []),
  ]);

  function activityLabel(kind: string): string {
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
        return "Idle";
    }
  }

  $effect(() => {
    const next = new Set(openRunIds);
    let changed = false;

    for (const run of helperRuns) {
      if (initializedRunIds.has(run.runId)) continue;
      initializedRunIds.add(run.runId);
      next.add(run.runId);
      changed = true;
    }

    if (changed) openRunIds = next;
  });

  $effect(() => {
    void chat.messages.length;
    void chat.activity.kind;

    tick().then(() => {
      if (!scrollContainer) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });
  });

  function send() {
    const text = input.trim();
    if (!text || chat.isBusy) return;

    chat.sendMessage({ text });
    input = "";
  }

  function usePrompt(prompt: string) {
    input = prompt;
  }

  function startNewChat() {
    chat.clearHistory();
    toolEvents.resetLocalState();
    openRunIds = new Set();
    initializedRunIds.clear();
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

  function toolCallId(part: unknown): string | null {
    if (typeof part !== "object" || part === null || !("toolCallId" in part)) return null;
    return typeof part.toolCallId === "string" ? part.toolCallId : null;
  }

  function toolRuns(part: unknown): AgentToolRunState[] {
    const id = toolCallId(part);
    return id ? toolEvents.getRunsForToolCall(id) : [];
  }

  function runText(run: AgentToolRunState): string {
    return run.parts.filter((part) => part.type === "text").map((part) => ("text" in part ? String(part.text ?? "") : "")).filter(Boolean).join("\n") || run.summary || "";
  }

  function runReasoning(run: AgentToolRunState): string {
    return run.parts.filter((part) => part.type === "reasoning").map((part) => ("text" in part ? String(part.text ?? "") : "")).filter(Boolean).join("\n");
  }

  function runDisplayStatus(run: AgentToolRunState): string {
    if (run.status !== "running") return run.status;
    if (runText(run)) return "summarizing";
    if (runReasoning(run)) return "thinking";
    return "running";
  }

  function runPreview(run: AgentToolRunState): string {
    const input = run.inputPreview;
    if (typeof input === "string") return input;
    if (typeof input !== "object" || input === null) return input === undefined ? "" : String(input);
    if ("query" in input && typeof input.query === "string") return input.query;
    if ("description" in input && typeof input.description === "string") return input.description;
    return JSON.stringify(input, null, 2);
  }

  function setRunOpen(runId: string, open: boolean) {
    const next = new Set(openRunIds);
    if (open) next.add(runId);
    else next.delete(runId);
    openRunIds = next;
  }

  function textFromPart(part: unknown): string {
    return typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part
      ? String(part.text ?? "")
      : "";
  }

  function reasoningFromPart(part: unknown): string {
    return typeof part === "object" && part !== null && "type" in part && part.type === "reasoning" && "text" in part
      ? String(part.text ?? "")
      : "";
  }
</script>

<svelte:head>
  <title>Agents as Tools · agents-svelte</title>
</svelte:head>

<ExampleChrome
  title="Agents as Tools"
  connected={agent.connected}
  connectionText={agent.connected ? "Connected" : "Connecting"}
  actionLabel="New"
  actionDisabled={chat.messages.length === 0 || chat.isBusy}
  onAction={startNewChat}
>
  {#snippet subbar()}
    <ExampleUsage
      title="Agents as tools"
      description="Helper Agents stream under their parent tool calls."
      modelId={MODEL_ID}
      {usage}
      costTitle="Gemma 4 cost estimate at $0.10/M input and $0.30/M output tokens"
      {status}
      extra={helperRunMeta}
    />
  {/snippet}

  <LiveStatus message={status} />

  <main bind:this={scrollContainer} class="messages">
    <div class="messages-inner">
      {#if chat.messages.length === 0}
        <section class="empty">
          <div class="empty-icon">⟡</div>
          <h2>Delegate work to helper Agents</h2>
          <p>
            Ask the parent Agent to research, plan, or compare. Tool calls create
            real child Agent runs and stream their progress into this chat.
          </p>
          <div class="prompt-list">
            {#each prompts as prompt}
              <button type="button" onclick={() => usePrompt(prompt)}>{prompt}</button>
            {/each}
          </div>
        </section>
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
                {:else if typeof part.type === "string" && part.type.startsWith("tool-")}
                  <section class="tool-card">
                    <div class="tool-heading">
                      <div>
                        <span>Parent tool</span>
                        <strong>{toolName(part)}</strong>
                      </div>
                      {#if toolState(part)}<em>{toolState(part)}</em>{/if}
                    </div>

                    {#if toolRuns(part).length > 0}
                      <div class="run-list">
                        {#each toolRuns(part) as run (run.runId)}
                          <details
                            class="run-card"
                            open={openRunIds.has(run.runId)}
                            ontoggle={(event) => setRunOpen(run.runId, event.currentTarget.open)}
                          >
                            <summary>
                              <div class="run-heading">
                                <span class="chevron" aria-hidden="true">▸</span>
                                <div>
                                  <span>Helper Agent</span>
                                  <strong>{run.display?.name ?? run.agentType}</strong>
                                </div>
                                <em class={runDisplayStatus(run)}>{runDisplayStatus(run)}</em>
                              </div>
                              {#if runPreview(run)}<small>{runPreview(run)}</small>{/if}
                            </summary>
                            {#if runReasoning(run)}
                              <details class="helper-reasoning">
                                <summary>Thinking</summary>
                                <p>{runReasoning(run)}</p>
                              </details>
                            {/if}
                            {#if runText(run)}<p>{runText(run)}</p>{/if}
                            {#if run.error}<p class="error">{run.error}</p>{/if}
                          </details>
                        {/each}
                      </div>
                    {:else}
                      <div class="waiting">Waiting for helper Agent events…</div>
                    {/if}
                  </section>
                {/if}
              {/each}
              {#if showStreamingCursor && message === chat.messages.at(-1) && message.role === "assistant"}
                <span class="cursor"></span>
              {/if}
            </div>
          </article>
        {/each}
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
        placeholder="Ask the assistant to research, plan, or compare…"
        aria-label="Message"
        onkeydown={(event) => {
          if (event.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>
      <button disabled={!agent.connected || !input.trim() || chat.isBusy}>Send</button>
    </form>
  {/snippet}
</ExampleChrome>

<style>
  h2, p { margin: 0; }
  .prompt-list button { border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.55rem 0.75rem; color: #111827; background: #fff; font-weight: 700; cursor: pointer; }
  .tool-heading, .run-heading { display: flex; align-items: center; gap: 0.75rem; }
  .messages { flex: 1; min-height: 0; overflow-y: auto; }
  .messages-inner { width: min(100%, 768px); min-height: 100%; margin: 0 auto; padding: 1.5rem 1.25rem; }
  .empty { display: grid; min-height: 50vh; place-content: center; justify-items: center; color: #6b7280; text-align: center; }
  .empty-icon { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; margin-bottom: 1rem; border: 1px solid #e5e7eb; border-radius: 999px; color: #2563eb; background: #ffffff; box-shadow: 0 8px 24px rgb(15 23 42 / 6%); }
  .empty h2 { margin-bottom: 0.5rem; color: #111827; font-size: 1.25rem; }
  .empty p { max-width: 34rem; line-height: 1.6; }
  .prompt-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; margin-top: 0.4rem; }

  .message { display: flex; margin-bottom: 1rem; }
  .message.user { justify-content: flex-end; }
  .bubble { width: min(85vw, 42rem); border: 1px solid #e5e7eb; border-radius: 1rem 1rem 1rem 0.25rem; padding: 0.75rem 1rem; color: #111827; background: #ffffff; line-height: 1.6; box-shadow: 0 1px 2px rgb(15 23 42 / 4%); }
  .user .bubble { border-color: #111827; border-bottom-right-radius: 0.25rem; border-bottom-left-radius: 1rem; color: #ffffff; background: #111827; }
  .bubble p { white-space: pre-wrap; }
  .bubble p + p { margin-top: 0.75rem; }
  .reasoning { margin-bottom: 0.75rem; border-radius: 0.75rem; padding: 0.625rem 0.75rem; color: #6b7280; background: #f3f4f6; }
  .reasoning summary { color: #4b5563; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
  .tool-card { display: grid; gap: 0.75rem; margin: 0.75rem 0; border: 1px solid #dbeafe; border-radius: 0.875rem; padding: 0.75rem; color: #1e3a8a; background: #eff6ff; }
  .tool-heading { justify-content: space-between; }
  .run-heading { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: 0.45rem; }
  .tool-heading span, .run-heading span:not(.chevron) { display: block; color: #64748b; font-size: 0.6875rem; font-weight: 750; letter-spacing: 0.04em; text-transform: uppercase; }
  .tool-heading strong, .run-heading strong { display: block; margin-top: 0.1rem; color: #111827; font-size: 0.875rem; }
  em { color: #64748b; font-size: 0.75rem; font-style: normal; font-weight: 700; }
  .run-list { display: grid; gap: 0.65rem; }
  .run-card { border: 1px solid #bfdbfe; border-radius: 0.75rem; padding: 0.625rem 0.75rem; background: #ffffff; }
  .run-card summary { display: grid; gap: 0.35rem; list-style: none; cursor: pointer; }
  .run-card summary::-webkit-details-marker { display: none; }
  .chevron { margin-top: 0.08rem; color: #64748b; font-size: 0.875rem; line-height: 1; transition: transform 0.15s ease; }
  .run-card[open] .chevron { transform: rotate(90deg); }
  .run-card summary > small, .run-card > p, .run-card > .helper-reasoning, .run-card > .error { margin-left: 1.325rem; }
  .run-card p { margin-top: 0.65rem; color: #374151; font-size: 0.875rem; }
  .run-card .running, .run-card .thinking, .run-card .summarizing { color: #2563eb; }
  .run-card .completed { color: #166534; }
  .run-card small { overflow-wrap: anywhere; color: #6b7280; font-size: 0.75rem; line-height: 1.4; }
  .helper-reasoning { margin-top: 0.65rem; border-radius: 0.65rem; padding: 0.5rem 0.625rem; color: #6b7280; background: #f3f4f6; }
  .helper-reasoning summary { display: revert; color: #4b5563; font-size: 0.75rem; font-weight: 700; list-style: revert; cursor: pointer; }
  .helper-reasoning p { margin-top: 0.5rem; font-size: 0.8125rem; font-style: italic; line-height: 1.5; white-space: pre-wrap; }
  .waiting { color: #6b7280; font-size: 0.8125rem; }
  .error { color: #991b1b !important; }
  .cursor { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -0.15em; background: #2563eb; animation: blink 1s step-end infinite; }
  .composer { display: flex; align-items: flex-end; gap: 0.75rem; padding: 1rem 1.25rem; }
  textarea { flex: 1; min-height: 2.75rem; max-height: 10rem; resize: vertical; border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.75rem 0.875rem; color: #111827; background: #ffffff; box-shadow: 0 1px 2px rgb(15 23 42 / 4%); line-height: 1.4; outline: none; }
  textarea:focus { border-color: transparent; box-shadow: 0 0 0 2px #93c5fd, 0 1px 2px rgb(15 23 42 / 4%); }
  button { flex: none; border: 0; border-radius: 0.875rem; padding: 0.75rem 1rem; color: #ffffff; background: #111827; font-weight: 700; cursor: pointer; }
  button:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.45; }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  @media (max-width: 640px) { .bubble { max-width: 92%; } }
</style>
