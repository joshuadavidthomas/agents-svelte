<script lang="ts">
  import { createAgent } from "../agent.svelte.ts";

  const props = $props<{
    token: string;
    query: (token: string) => Promise<Record<string, string | null>>;
  }>();

  const agent = createAgent({
    agent: "TestAgent",
    name: "reactive-query",
    host: "localhost:8787",
    protocol: "ws",
    query: async () => {
      const token = props.token;
      return props.query(token);
    },
  });
</script>

<p data-query-status={agent.queryStatus}>{agent.queryError?.message ?? ""}</p>
