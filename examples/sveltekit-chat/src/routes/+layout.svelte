<script lang="ts">
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap"
  />
  <script src="https://ui.sh/ui-picker.js"></script>
</svelte:head>

{@render children()}
