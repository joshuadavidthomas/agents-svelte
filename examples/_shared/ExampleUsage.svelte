<script lang="ts">
  type Usage = {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    estimated?: boolean;
  };

  type Props = {
    title: string;
    description: string;
    modelId: string;
    usage: Usage;
    costTitle: string;
    status: string;
    extra?: string[];
  };

  let { title, description, modelId, usage, costTitle, status, extra = [] }: Props = $props();

  const formattedCost = $derived(usage.cost === 0 ? "$0.000000" : `$${usage.cost.toFixed(6)}`);
</script>

<div class="subbar-copy">
  <h2>{title}</h2>
  <p>{description}</p>
</div>
<div class="usage-group">
  <code>{modelId}</code>
  <div class="usage-meta" title={costTitle}>
    <span>{usage.inputTokens.toLocaleString()} in</span>
    <span>{usage.outputTokens.toLocaleString()} out</span>
    <strong>{formattedCost}</strong>
    {#if usage.estimated}<em>est.</em>{/if}
    <span>{status}</span>
    {#each extra as item}<span>{item}</span>{/each}
  </div>
</div>

<style>
  h2, p { margin: 0; }
  h2 { margin-bottom: 0.25rem; font-size: 0.875rem; }
  .subbar-copy p, .usage-meta { color: #6b7280; font-size: 0.75rem; }
  .usage-group { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; }
  code { overflow: hidden; max-width: 18rem; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
  .usage-meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; white-space: nowrap; }
  .usage-meta strong { color: #111827; font-size: 0.75rem; }
  .usage-meta em { color: #9ca3af; font-style: normal; }
</style>
