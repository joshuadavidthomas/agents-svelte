<script lang="ts">
  import { Agent } from "../agent.svelte.ts";
  import { createAgentChat } from "../chat.svelte.ts";

  const props = $props<{
    getInitialMessages: () => Promise<[]>;
  }>();

  const agent = new Agent({
    agent: "TestAgent",
    name: "direct-chat-room",
    host: "localhost:8787",
    protocol: "ws",
  });

  const chat = createAgentChat({
    agent,
    getInitialMessages: () => props.getInitialMessages(),
    resume: false,
  });
</script>

<p data-chat-initialized={chat.initialized}>{agent.connected}</p>
