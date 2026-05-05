<script lang="ts">
  import { createAgent } from "../agent.svelte.ts";
  import { createAgentToolEvents } from "../tool-events.svelte.ts";

  const token = $state({ current: "one" });

  const agent = createAgent({
    agent: "TestAgent",
    name: "tool-events-room",
    host: "localhost:8787",
    protocol: "ws",
    query: async () => ({ token: token.current }),
  });
  const toolEvents = createAgentToolEvents({ agent });
</script>

<p data-run-count={Object.keys(toolEvents.runsById).length}>
  {Object.keys(toolEvents.runsById).join(",")}
</p>
