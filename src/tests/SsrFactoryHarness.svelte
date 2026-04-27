<script lang="ts">
  import { createAgent } from "../agent.svelte.ts";
  import { createAgentChat } from "../chat.svelte.ts";
  import { createVoiceAgent, createVoiceInput } from "../voice.svelte.ts";

  const agent = createAgent({ agent: "TestAgent", name: "ssr-room" });
  const chat = createAgentChat({
    agent,
    getInitialMessages: null,
    initialMessages: []
  });
  const voice = createVoiceAgent({ agent: "TestVoiceAgent", name: "ssr-room" });
  const voiceInput = createVoiceInput({
    agent: "TestVoiceInputAgent",
    name: "ssr-room"
  });
</script>

<p data-agent-connected={agent.connected} data-agent={agent.identity.agent}>
  {agent.identity.name}
</p>
<p data-chat-initialized={chat.initialized}>{chat.messages.length}</p>
<p data-voice-connected={voice.connected}>{voice.status}</p>
<p data-voice-input-listening={voiceInput.isListening}>{voiceInput.transcript}</p>
