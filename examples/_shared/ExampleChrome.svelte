<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    badge?: string;
    connected?: boolean;
    connectionText?: string;
    actionLabel?: string;
    actionDisabled?: boolean;
    onAction?: () => void;
    children: Snippet;
    subbar?: Snippet;
    composer?: Snippet;
    contentWidth?: "chat" | "wide" | "full";
  };

  let {
    title,
    badge = "Svelte",
    connected,
    connectionText,
    actionLabel,
    actionDisabled = false,
    onAction,
    children,
    subbar,
    composer,
    contentWidth = "chat",
  }: Props = $props();
</script>

<div class="shell">
  <header class="topbar">
    <div class="topbar-inner" data-width={contentWidth}>
      <div class="title-row">
        <h1>{title}</h1>
        <div class="badge">{badge}</div>
      </div>

      <div class="header-actions">
        {#if connectionText}
          <div class:online={connected} class="connection">
            <span></span>
            {connectionText}
          </div>
        {/if}
        {#if actionLabel && onAction}
          <button class="ghost" type="button" disabled={actionDisabled} onclick={onAction}>{actionLabel}</button>
        {/if}
      </div>
    </div>
  </header>

  {#if subbar}
    <div class="subbar">
      <div class="subbar-inner" data-width={contentWidth}>
        {@render subbar()}
      </div>
    </div>
  {/if}

  {@render children()}

  {#if composer}
    <footer class="composer-wrap">
      <div class="composer-inner" data-width={contentWidth}>
        {@render composer()}
      </div>
    </footer>
  {/if}
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; }
  :global(body) { color: #111827; background: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(button, textarea) { font: inherit; }

  .shell { display: flex; flex-direction: column; height: 100vh; background: #f8fafc; }
  .topbar { flex: none; border-bottom: 1px solid #e5e7eb; background: #ffffff; }
  .topbar-inner, .subbar-inner, .composer-inner { width: min(100%, 768px); margin: 0 auto; }
  .topbar-inner[data-width="wide"], .subbar-inner[data-width="wide"], .composer-inner[data-width="wide"] { width: min(100%, 72rem); }
  .topbar-inner[data-width="full"], .subbar-inner[data-width="full"], .composer-inner[data-width="full"] { width: 100%; }
  .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; }
  h1 { margin: 0; font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
  .title-row, .header-actions, .connection { display: flex; align-items: center; }
  .title-row { gap: 0.75rem; }
  .header-actions { gap: 0.75rem; }
  .badge { border: 1px solid #e5e7eb; border-radius: 999px; padding: 0.2rem 0.5rem; color: #4b5563; background: #f9fafb; font-size: 0.75rem; font-weight: 650; }
  .connection { gap: 0.45rem; color: #6b7280; font-size: 0.75rem; font-weight: 600; }
  .connection span { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #f59e0b; }
  .connection.online span { background: #10b981; }
  .subbar { flex: none; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
  .subbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.25rem; }
  .ghost { flex: none; border: 1px solid #e5e7eb; border-radius: 0.875rem; padding: 0.75rem 1rem; color: #111827; background: #ffffff; font-weight: 700; cursor: pointer; }
  .ghost:disabled { cursor: not-allowed; opacity: 0.45; }
  .composer-wrap { flex: none; border-top: 1px solid #e5e7eb; background: #ffffff; }

  @media (max-width: 640px) {
    .topbar-inner { align-items: flex-start; flex-direction: column; }
    .header-actions, .subbar-inner { width: 100%; justify-content: space-between; }
    .subbar-inner { align-items: flex-start; flex-direction: column; }
  }
</style>
