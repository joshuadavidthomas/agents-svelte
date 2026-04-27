<script lang="ts">
  import { createAgent } from "../agent.svelte.ts";
  import { createAgentChat } from "../chat.svelte.ts";
  import { createVoiceAgent, createVoiceInput, type VoiceTransport } from "../voice.svelte.ts";

  const props = $props<{
    getInitialMessages: () => Promise<[]>;
    voiceTransport: VoiceTransport;
    voiceInputTransport: VoiceTransport;
  }>();

  const voiceTransport: VoiceTransport = {
    get connected() {
      return props.voiceTransport.connected;
    },
    get onopen() {
      return props.voiceTransport.onopen;
    },
    set onopen(listener) {
      props.voiceTransport.onopen = listener;
    },
    get onclose() {
      return props.voiceTransport.onclose;
    },
    set onclose(listener) {
      props.voiceTransport.onclose = listener;
    },
    get onerror() {
      return props.voiceTransport.onerror;
    },
    set onerror(listener) {
      props.voiceTransport.onerror = listener;
    },
    get onmessage() {
      return props.voiceTransport.onmessage;
    },
    set onmessage(listener) {
      props.voiceTransport.onmessage = listener;
    },
    connect: () => props.voiceTransport.connect(),
    disconnect: () => props.voiceTransport.disconnect(),
    sendJSON: (data) => props.voiceTransport.sendJSON(data),
    sendBinary: (data) => props.voiceTransport.sendBinary(data),
  };

  const voiceInputTransport: VoiceTransport = {
    get connected() {
      return props.voiceInputTransport.connected;
    },
    get onopen() {
      return props.voiceInputTransport.onopen;
    },
    set onopen(listener) {
      props.voiceInputTransport.onopen = listener;
    },
    get onclose() {
      return props.voiceInputTransport.onclose;
    },
    set onclose(listener) {
      props.voiceInputTransport.onclose = listener;
    },
    get onerror() {
      return props.voiceInputTransport.onerror;
    },
    set onerror(listener) {
      props.voiceInputTransport.onerror = listener;
    },
    get onmessage() {
      return props.voiceInputTransport.onmessage;
    },
    set onmessage(listener) {
      props.voiceInputTransport.onmessage = listener;
    },
    connect: () => props.voiceInputTransport.connect(),
    disconnect: () => props.voiceInputTransport.disconnect(),
    sendJSON: (data) => props.voiceInputTransport.sendJSON(data),
    sendBinary: (data) => props.voiceInputTransport.sendBinary(data),
  };

  const agent = createAgent({
    agent: "TestAgent",
    name: "factory-room",
    host: "localhost:8787",
    protocol: "ws",
  });
  const chat = createAgentChat({
    agent,
    getInitialMessages: () => props.getInitialMessages(),
    resume: true,
  });
  const voice = createVoiceAgent({
    agent: "TestVoiceAgent",
    transport: voiceTransport,
  });
  const voiceInput = createVoiceInput({
    agent: "TestVoiceInputAgent",
    transport: voiceInputTransport,
  });
</script>

<p data-chat-initialized={chat.initialized}>{agent.connected}</p>
<p data-voice-connected={voice.connected}>{voice.status}</p>
<p data-voice-input-listening={voiceInput.isListening}>{voiceInput.transcript}</p>
