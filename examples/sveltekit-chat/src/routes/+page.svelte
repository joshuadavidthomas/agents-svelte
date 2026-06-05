<script lang="ts">
  import { createAgent } from "agents-svelte";
  import { createAgentChat } from "agents-svelte/chat";
  import { calculateTokenUsage } from "../../../_shared/usage";

  type PageData = { threadId: string; readmeHtml: string };
  let { data }: { data: PageData } = $props();

  const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
  const MODEL_INPUT_COST_PER_MILLION = 0.1;
  const MODEL_OUTPUT_COST_PER_MILLION = 0.3;

  // svelte-ignore state_referenced_locally
  const agent = createAgent({ agent: "ChatAgent", name: data.threadId });
  const chat = createAgentChat({ agent });

  let input = $state("");

  const connectedText = $derived(
    agent.identity.identified ? "connected" : agent.connected ? "connecting" : "offline",
  );
  const usage = $derived(
    calculateTokenUsage(chat.messages, {
      inputCostPerMillion: MODEL_INPUT_COST_PER_MILLION,
      outputCostPerMillion: MODEL_OUTPUT_COST_PER_MILLION,
    }),
  );
  const formattedCost = $derived(
    usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`,
  );
  const status = $derived(activityLabel(chat.activity.kind));
  const canStop = $derived(
    chat.activity.kind === "submitted" ||
      chat.activity.kind === "streaming" ||
      chat.activity.kind === "tool-continuation",
  );
  const showStreamingCursor = $derived(
    chat.activity.kind === "streaming" || chat.activity.kind === "tool-continuation",
  );
  const scrollTrigger = $derived(`${chat.messages.length}:${chat.activity.kind}`);

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

  const scrollContainers = new Set<HTMLElement>();
  function trackScroll(el: HTMLElement) {
    scrollContainers.add(el);
    return {
      destroy() {
        scrollContainers.delete(el);
      },
    };
  }

  $effect(() => {
    void scrollTrigger;
    requestAnimationFrame(() => {
      for (const el of scrollContainers) {
        el.scrollTo({ top: el.scrollHeight });
      }
    });
  });

  function send() {
    const text = input.trim();
    if (!text || chat.isBusy) return;
    chat.sendMessage({ text });
    input = "";
  }

  function clear() {
    chat.clearHistory();
    input = "";
  }

  function onComposerKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }
</script>

<svelte:head>
  <title>SvelteKit chat · Cloudflare Agents Svelte</title>
  <meta name="description" content="SvelteKit chat example for agents-svelte" />
</svelte:head>

<main class="max-w-7xl mx-auto bg-white font-geist text-zinc-900 antialiased isolate lg:grid lg:grid-rows-[auto_minmax(0,1fr)] h-full px-3 sm:px-6">
  <header class="mx-auto flex gap-2 items-center justify-between py-3 sm:py-3.5 lg:px-10 w-full">
    <nav class="flex items-center gap-1 font-geist-mono text-xs text-zinc-500">
      <span class="hidden sm:inline">agents-svelte</span>
      <span class="sm:hidden">...</span>
      <span class="text-zinc-300">/</span>
      <span>examples</span>
      <span class="text-zinc-300">/</span>
      <span class="text-zinc-900">sveltekit-chat</span>
    </nav>
    <span class="inline-flex items-center gap-1.5 rounded-md bg-zinc-50 px-2 py-1 font-geist-mono text-[0.7rem] text-zinc-600 ring-1 ring-zinc-950/5">
      <span class="size-1.5 rounded-full {agent.identity.identified ? 'bg-emerald-500' : agent.connected ? 'bg-amber-500' : 'bg-zinc-400'}"></span>
      {connectedText}
    </span>
  </header>

  <div class="px-px mx-auto flex w-full max-w-7xl flex-col gap-6 pt-2 pb-5 lg:grid lg:min-h-0 lg:grid-cols-[5fr_7fr] lg:grid-rows-1 lg:gap-6 lg:overflow-hidden">
    <section class="mx-4 lg:mx-0 flex flex-col overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-zinc-950/5 lg:col-start-2 lg:row-start-1 lg:min-h-0">
      <div class="flex justify-between items-center px-4 py-2 border-b border-zinc-950/5 bg-zinc-50">
        <dl class="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-geist-mono text-[0.72rem] text-zinc-500">
          <div class="flex items-center gap-1.5">
            <dt class="text-zinc-400">status</dt>
            <dd class="text-zinc-900">{status.toLowerCase()}</dd>
          </div>
          <div class="flex items-center gap-1.5 min-w-0">
            <dt class="text-zinc-400">model</dt>
            <dd class="truncate text-zinc-900" title={MODEL_ID}>gemma-4 26b</dd>
          </div>
          <div class="flex items-center gap-1.5 ml-auto">
            <dt class="text-zinc-400">usage</dt>
            <dd class="tabular-nums text-zinc-900">{usage.totalTokens} tk · {formattedCost}</dd>
          </div>
        </dl>
        <div>
          {#if canStop}
            <button
              type="button"
              class="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-xs ring-1 ring-zinc-950/10 hover:bg-zinc-50"
              onclick={() => chat.stop()}
            >
              Stop
            </button>
          {/if}
          <button
            type="button"
            class="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-xs ring-1 ring-zinc-950/10 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
            disabled={chat.messages.length === 0 || chat.isBusy}
            onclick={clear}
          >
            Reset
          </button>
        </div>
      </div>

      <div use:trackScroll class="px-4 py-5 lg:flex-1 lg:overflow-y-auto h-92 lg:h-auto">
        <div class="flex flex-col gap-8">
          {#if chat.messages.length === 0}
            <div class="my-auto rounded-lg bg-zinc-50 p-8 text-center ring-1 ring-zinc-950/5">
              <p class="text-base font-medium text-zinc-900">Try it out</p>
              <p class="mt-1.5 text-sm text-zinc-500">
                Send a message and the agent will stream a reply.
              </p>
            </div>
          {:else}
            {#each chat.messages as message (message.id)}
              <article class="flex flex-col gap-1 {message.role === 'user' ? 'items-end' : 'items-start'}">
                <div class="text-sm leading-relaxed {message.role === 'user' ? 'max-w-[88%] rounded-lg rounded-br-[0.125rem] bg-zinc-900 px-3.5 py-2.5 text-zinc-50' : 'w-full max-w-[88%] text-zinc-900'}">
                  {#each message.parts as part}
                    {#if part.type === 'text'}
                      <p class="first:mt-0 [&:not(:first-child)]:mt-2">{part.text}</p>
                    {:else if part.type === 'reasoning'}
                      <details class="my-1 rounded-md bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600 ring-1 ring-zinc-950/5">
                        <summary class="cursor-pointer font-geist-mono text-[0.65rem] uppercase tracking-wide">thinking</summary>
                        <p class="mt-1.5 whitespace-pre-wrap italic">{part.text}</p>
                      </details>
                    {/if}
                  {/each}
                  {#if showStreamingCursor && message === chat.messages.at(-1) && message.role === 'assistant'}
                    <span class="ml-0.5 inline-block h-[1em] w-1.5 -translate-y-px animate-pulse bg-orange-500 align-middle"></span>
                  {/if}
                </div>
              </article>
            {/each}
          {/if}
        </div>
      </div>

      <form
        class="border-t border-zinc-950/5 px-3 py-3"
        onsubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div
          class="flex items-end gap-2 rounded-xl bg-white p-1.5 shadow-xs ring-1 ring-zinc-950/10 focus-within:ring-2 focus-within:ring-zinc-900"
        >
          <textarea
            name="message"
            bind:value={input}
            placeholder="Send a message…"
            aria-label="Message"
            rows="1"
            disabled={chat.isBusy}
            onkeydown={onComposerKey}
            class="block max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50 max-sm:text-base [field-sizing:content]"
          ></textarea>
          <button
            type="submit"
            disabled={!input.trim() || chat.isBusy}
            aria-label="Send message"
            class="relative grid size-7 shrink-0 place-items-center self-end rounded-md bg-zinc-900 text-white hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:pointer-events-none disabled:bg-zinc-200 disabled:text-zinc-400"
          >
            <span
              class="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
              aria-hidden="true"
            ></span>
            <svg viewBox="0 0 24 24" fill="currentColor" class="size-4" aria-hidden="true">
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        </div>
      </form>
    </section>

    <aside class="flex flex-col lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-hidden">
      <div class="prose lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {@html data.readmeHtml}
      </div>
    </aside>
  </div>
</main>
