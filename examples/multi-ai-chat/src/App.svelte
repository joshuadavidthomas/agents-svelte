<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Agent, createAgent } from "agents-svelte";
  import { AgentChat, AgentToolEvents, type AgentToolRunState } from "agents-svelte/chat";
  import LiveStatus from "../../_shared/LiveStatus.svelte";
  import { calculateTokenUsage } from "../../_shared/usage";

  type ChatSummary = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    lastMessagePreview?: string;
  };

  type InboxState = { chats: ChatSummary[] };

  type InboxMethods = {
    createChat(opts?: { title?: string }): Promise<string>;
    renameChat(id: string, title: string): Promise<void>;
    deleteChat(id: string): Promise<void>;
    getSharedMemory(label?: string): Promise<string>;
    setSharedMemory(label: string, content: string): Promise<string>;
  };

  const DEMO_USER = "demo-user";
  const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
  const MODEL_INPUT_COST_PER_MILLION = 0.1;
  const MODEL_OUTPUT_COST_PER_MILLION = 0.3;

  class ChatSession {
    readonly agent: Agent;
    readonly chat: AgentChat;
    readonly toolEvents: AgentToolEvents;

    constructor(chatId: string) {
      this.agent = new Agent({ agent: "Inbox", name: DEMO_USER, sub: [{ agent: "Chat", name: chatId }] });
      this.chat = new AgentChat({ agent: this.agent });
      this.toolEvents = new AgentToolEvents({ agent: this.agent });
    }

    connect() {
      this.chat.connect();
    }

    close() {
      this.toolEvents.close();
      this.chat.close();
      this.agent.close();
    }
  }

  const inbox = createAgent<InboxMethods, InboxState>({ agent: "Inbox", name: DEMO_USER });

  let activeId = $state<string | null>(null);
  let pendingActiveId = $state<string | null>(null);
  let input = $state("");
  let memory = $state("");
  let memoryDraft = $state("");
  let memorySaved = $state(false);
  let memorySavedTimeout: ReturnType<typeof setTimeout> | undefined;
  let scrollContainer = $state<HTMLElement>();
  let activeSession = $state.raw<ChatSession | null>(null);
  let editingChatId = $state<string | null>(null);
  let editingTitle = $state("");
  let deletingChatId = $state<string | null>(null);

  const chats = $derived(inbox.state?.chats ?? []);
  const activeChatSummary = $derived(chats.find((chat) => chat.id === activeId));
  const chat = $derived(activeSession?.chat ?? null);
  const toolEvents = $derived(activeSession?.toolEvents ?? null);
  const usage = $derived(
    calculateTokenUsage(chat?.messages, {
      inputCostPerMillion: MODEL_INPUT_COST_PER_MILLION,
      outputCostPerMillion: MODEL_OUTPUT_COST_PER_MILLION,
    }),
  );
  const status = $derived(activityLabel(chat?.activity.kind));
  const formattedCost = $derived(usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`);

  function activityLabel(kind: string | undefined): string {
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
    const activeExists = activeId ? chats.some((chat) => chat.id === activeId) : false;
    if (pendingActiveId && chats.some((chat) => chat.id === pendingActiveId)) pendingActiveId = null;
    if (!activeId && chats.length > 0) setActiveChat(chats[0].id);
    if (activeId && chats.length > 0 && !activeExists && activeId !== pendingActiveId) setActiveChat(chats[0].id);
    if (activeId && chats.length === 0 && activeId !== pendingActiveId) setActiveChat(null);
  });

  onMount(() => {
    void loadMemory();
  });

  onDestroy(() => {
    if (memorySavedTimeout) clearTimeout(memorySavedTimeout);
    activeSession?.close();
  });

  $effect(() => {
    const session = activeSession;
    const socket = session?.agent.socket;
    if (!session) return;
    session.toolEvents.connect(socket ?? null);
    return () => session.toolEvents.close();
  });

  $effect(() => {
    void chat?.messages.length;
    void chat?.activity.kind;
    requestAnimationFrame(() => scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight }));
  });

  async function createChat() {
    const id = await inbox.stub.createChat();
    pendingActiveId = id;
    setActiveChat(id);
  }

  function startRename(summary: ChatSummary) {
    editingChatId = summary.id;
    editingTitle = summary.title;
    deletingChatId = null;
  }

  function cancelRename() {
    editingChatId = null;
    editingTitle = "";
  }

  async function saveRename(summary: ChatSummary) {
    const title = editingTitle.trim();
    if (!title) return;
    await inbox.stub.renameChat(summary.id, title);
    cancelRename();
  }

  function requestDelete(summary: ChatSummary) {
    deletingChatId = summary.id;
    editingChatId = null;
  }

  function cancelDelete() {
    deletingChatId = null;
  }

  async function confirmDelete(summary: ChatSummary) {
    await inbox.stub.deleteChat(summary.id);
    deletingChatId = null;
    if (activeId === summary.id) setActiveChat(null);
  }

  async function loadMemory() {
    const next = await inbox.stub.getSharedMemory("memory");
    memory = next;
    memoryDraft = next;
  }

  async function saveMemory() {
    memory = await inbox.stub.setSharedMemory("memory", memoryDraft);
    memoryDraft = memory;
    memorySaved = true;
    if (memorySavedTimeout) clearTimeout(memorySavedTimeout);
    memorySavedTimeout = setTimeout(() => {
      memorySaved = false;
      memorySavedTimeout = undefined;
    }, 1500);
  }

  function send() {
    const text = input.trim();
    if (!text || !chat || chat.isBusy) return;
    chat.sendMessage({ text });
    input = "";
  }

  function setActiveChat(id: string | null) {
    if (id === activeId) return;

    activeSession?.close();
    activeId = id;
    if (!id) pendingActiveId = null;
    editingChatId = null;
    deletingChatId = null;

    if (!id) {
      activeSession = null;
      return;
    }

    const nextSession = new ChatSession(id);
    activeSession = nextSession;
    nextSession.connect();
  }

  function selectChat(id: string) {
    setActiveChat(id);
  }

  function partText(part: unknown): string {
    return typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : "";
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

  function toolCallId(part: unknown): string | null {
    if (typeof part !== "object" || part === null || !("toolCallId" in part)) return null;
    return typeof part.toolCallId === "string" ? part.toolCallId : null;
  }

  function toolRuns(part: unknown): AgentToolRunState[] {
    const id = toolCallId(part);
    return id && toolEvents ? toolEvents.getRunsForToolCall(id) : [];
  }

  function runText(run: AgentToolRunState): string {
    return run.parts.map((part) => partText(part)).filter(Boolean).join("\n");
  }

  function runPreview(run: AgentToolRunState): string {
    if (typeof run.inputPreview === "string") return run.inputPreview;
    return run.inputPreview === undefined ? "" : JSON.stringify(run.inputPreview);
  }
</script>

<svelte:head><title>Multi AI Chat</title></svelte:head>

<div class="app">
  <header class="header">
    <div class="header-inner">
      <div class="title-row">
        <h1>Multi AI Chat</h1>
        <span class="badge">Svelte</span>
      </div>
      <div class="status" class:connected={inbox.connected}>{inbox.connected ? "Connected" : "Connecting"}</div>
    </div>
  </header>

  <main class="layout">
    <aside class="sidebar">
      <section class="info-card">
        <h2>Multi-session AI chat</h2>
        <p>One Inbox Durable Object owns the list of chats and shared per-user memory. Each chat is its own AIChatAgent Durable Object.</p>
      </section>

      <div class="section-heading">
        <h3>Chats</h3>
        <button type="button" onclick={createChat}>New</button>
      </div>

      <div class="sidebar-scroll">
        <div class="chat-list">
          {#if chats.length === 0}
            <p class="muted">No chats yet. Click New to start one.</p>
          {:else}
            {#each chats as summary (summary.id)}
              <button
                class:active={summary.id === activeId}
                class="chat-item"
                type="button"
                aria-current={summary.id === activeId ? "page" : undefined}
                onclick={() => selectChat(summary.id)}
              >
                <span>
                  <strong>{summary.title}</strong>
                  <small>{summary.lastMessagePreview || "No messages yet"}</small>
                </span>
              </button>
              {#if editingChatId === summary.id}
                <form
                  class="inline-edit"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void saveRename(summary);
                  }}
                >
                  <input bind:value={editingTitle} aria-label={`New title for ${summary.title}`} />
                  <button type="submit" disabled={!editingTitle.trim()}>Save</button>
                  <button type="button" onclick={cancelRename}>Cancel</button>
                </form>
              {:else if deletingChatId === summary.id}
                <div class="inline-confirm" role="group" aria-label={`Delete ${summary.title}?`}>
                  <span>Delete this chat?</span>
                  <button type="button" onclick={() => confirmDelete(summary)}>Delete</button>
                  <button type="button" onclick={cancelDelete}>Cancel</button>
                </div>
              {:else}
                <div class="chat-actions">
                  <button type="button" onclick={() => startRename(summary)}>Rename</button>
                  <button type="button" onclick={() => requestDelete(summary)}>Delete</button>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>

      <section class="memory">
        <h3>Shared memory</h3>
        <textarea bind:value={memoryDraft} placeholder="Facts to remember across chats…" aria-label="Shared memory"></textarea>
        <button type="button" onclick={saveMemory}>Save memory</button>
        {#if memorySaved}<span>Saved</span>{/if}
      </section>

      <footer class="sidebar-footer">
        <code>{MODEL_ID}</code>
        <div class="usage-meta" title="Gemma 4 cost estimate at $0.10/M input and $0.30/M output tokens">
          <span>{usage.inputTokens.toLocaleString()} in</span>
          <span>{usage.outputTokens.toLocaleString()} out</span>
          <strong>{formattedCost}</strong>
          {#if usage.estimated}<em>est.</em>{/if}
        </div>
        <div class="usage-meta"><span>{status}</span></div>
      </footer>
    </aside>

    <section class="chat-panel">
      {#if !activeId || !chat}
        <div class="center-card">Create a chat to get started.</div>
      {:else}
        <div class="chat-header"><h2>{activeChatSummary?.title ?? "Chat"}</h2></div>
        <LiveStatus message={status} />

        <div bind:this={scrollContainer} class="messages">
          {#if chat.messages.length === 0}
            <div class="empty">Send the first message to start this chat. Try: <em>“Remember I prefer concise answers”</em> or <em>“What time is it?”</em></div>
          {/if}
          {#each chat.messages as message (message.id)}
            <article class:assistant={message.role === "assistant"} class:user={message.role === "user"} class="message">
              {#each message.parts as part}
                {#if part.type === "text"}
                  <p>{part.text}</p>
                {:else if part.type === "reasoning" && part.text?.trim()}
                  <details class="reasoning"><summary>Thinking</summary><p>{part.text}</p></details>
                {:else if part.type.startsWith("tool-")}
                  <div class="tool-card">
                    <strong>{toolName(part)}</strong>
                    <span>{toolState(part)}</span>
                    {#if toolOutput(part) !== undefined}<pre>{JSON.stringify(toolOutput(part), null, 2)}</pre>{/if}
                    {#each toolRuns(part) as run (run.runId)}
                      <div class="tool-run">
                        <div class="tool-run-header">
                          <strong>{run.display?.name ?? run.agentType}</strong>
                          <span>{run.status}</span>
                        </div>
                        {#if runPreview(run)}<small>{runPreview(run)}</small>{/if}
                        {#if runText(run)}<p>{runText(run)}</p>{/if}
                        {#if run.summary}<p>{run.summary}</p>{/if}
                        {#if run.error}<p class="tool-run-error">{run.error}</p>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </article>
          {/each}
        </div>
        <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
          <textarea
            bind:value={input}
            placeholder="Type a message…"
            rows="1"
            aria-label="Message"
            onkeydown={(event) => {
              if (event.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          ></textarea>
          <button disabled={!input.trim() || chat.isBusy} type="submit">Send</button>
        </form>
      {/if}
    </section>
  </main>
</div>

<style>
  :global(body) { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #111827; background: #f5f6f8; }
  :global(*) { box-sizing: border-box; }
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .header { border-bottom: 1px solid #e5e7eb; background: #fff; padding: 0.875rem 1.25rem; }
  .header-inner { display: flex; align-items: center; justify-content: space-between; max-width: 72rem; margin: 0 auto; }
  .title-row { display: flex; align-items: center; gap: 0.625rem; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 0.9375rem; }
  h2 { font-size: 0.875rem; }
  h3 { font-size: 0.8125rem; }
  .badge { border: 1px solid #e5e7eb; border-radius: 999px; padding: 0.125rem 0.5rem; color: #6b7280; background: #f9fafb; font-size: 0.6875rem; font-weight: 650; }
  .status { color: #92400e; font-size: 0.8125rem; font-weight: 650; }
  .status.connected { color: #047857; }
  .layout { display: grid; grid-template-columns: 20rem 1fr; flex: 1; min-height: 0; overflow: hidden; }
  .sidebar { display: flex; flex-direction: column; gap: 1rem; min-height: 0; overflow: hidden; border-right: 1px solid #e5e7eb; padding: 1rem; background: #fff; }
  .info-card { border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.875rem; }
  .info-card p, .muted, .chat-item small, .usage-meta { color: #6b7280; font-size: 0.75rem; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; }
  button { border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.5rem 0.75rem; background: #fff; color: #111827; font: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: 0.55; }
  .sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-right: 0.25rem; }
  .chat-list { display: grid; gap: 0.5rem; }
  .chat-item { display: block; width: 100%; text-align: left; border-color: #e5e7eb; }
  .chat-item.active { border-color: #111827; }
  .chat-item span { display: grid; gap: 0.25rem; }
  .chat-actions, .inline-edit, .inline-confirm { display: flex; gap: 0.375rem; margin-top: -0.375rem; }
  .chat-actions button, .inline-edit button, .inline-confirm button { padding: 0.25rem 0.5rem; color: #6b7280; font-size: 0.75rem; }
  .inline-edit { align-items: center; }
  .inline-edit input { min-width: 0; flex: 1; border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 0.375rem 0.5rem; font: inherit; font-size: 0.75rem; }
  .inline-confirm { align-items: center; flex-wrap: wrap; color: #92400e; font-size: 0.75rem; }
  .memory { display: grid; gap: 0.5rem; }
  .memory textarea { min-height: 6rem; resize: vertical; border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 0.75rem; font: inherit; }
  .sidebar-footer { display: grid; flex: 0 0 auto; gap: 0.375rem; border-top: 1px solid #e5e7eb; padding-top: 0.875rem; }
  .sidebar-footer code { color: #374151; font-size: 0.75rem; }
  .usage-meta { display: flex; gap: 0.375rem; align-items: center; flex-wrap: wrap; }
  .usage-meta strong { color: #374151; }
  .usage-meta em { font-style: normal; }
  .chat-panel { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
  .chat-header { border-bottom: 1px solid #e5e7eb; padding: 1rem 1.25rem; background: #fff; }
  .messages { position: absolute; inset: 3.25rem 0 0; overflow-y: auto; padding: 2rem 1.25rem 7rem; }
  .message { max-width: 48rem; margin: 0 auto 0.875rem; border-radius: 0.875rem; padding: 0.875rem 1rem; line-height: 1.5; }
  .message.user { margin-left: auto; background: #111827; color: #fff; }
  .message.assistant { margin-right: auto; border: 1px solid #e5e7eb; background: #fff; }
  .message p + p { margin-top: 0.75rem; }
  .reasoning { margin-bottom: 0.75rem; border-radius: 0.75rem; padding: 0.625rem 0.75rem; color: #6b7280; background: #f3f4f6; }
  .reasoning summary { color: #4b5563; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
  .reasoning p { margin-top: 0.5rem; font-size: 0.8125rem; font-style: italic; line-height: 1.5; white-space: pre-wrap; }
  .tool-card { display: grid; gap: 0.5rem; margin-top: 0.5rem; border: 1px solid #bfdbfe; border-radius: 0.75rem; padding: 0.75rem; background: #eff6ff; color: #1e3a8a; font-size: 0.8125rem; }
  .tool-run { display: grid; gap: 0.375rem; border-top: 1px solid #bfdbfe; padding-top: 0.5rem; }
  .tool-run-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .tool-run small, .tool-run p { white-space: pre-wrap; }
  .tool-run-error { color: #991b1b; }
  pre { overflow-x: auto; margin: 0; white-space: pre-wrap; }
  .empty, .center-card { max-width: 36rem; margin: 2rem auto; border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 2rem; background: #fff; color: #6b7280; text-align: center; }
  .composer { position: absolute; right: 0; bottom: 0; left: 0; display: flex; gap: 0.5rem; border-top: 1px solid #e5e7eb; padding: 1rem; background: rgb(255 255 255 / 0.94); }
  .composer textarea { flex: 1; resize: none; border: 1px solid #d1d5db; border-radius: 0.75rem; padding: 0.75rem; font: inherit; }
  .composer button { color: #fff; background: #111827; }
</style>
