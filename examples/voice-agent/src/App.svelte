<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    VoiceAgent,
    type VoiceStatus,
  } from "@joshthomas/cloudflare-agents-svelte/voice";
  import { SFUAudioInput, type VoiceTransportMode } from "./sfu-voice.svelte";

  type SttModel = "flux" | "nova-3";
  type LlmModel = "glm" | "gpt-oss-20b" | "kimi";

  const SESSION_KEY = "cloudflare-agents-svelte-voice-agent-session-id";

  function getSessionId(): string {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function formatTime(timestamp?: number): string {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function statusLabel(status: VoiceStatus): string {
    switch (status) {
      case "listening":
        return "Listening";
      case "thinking":
        return "Thinking";
      case "speaking":
        return "Speaking";
      case "idle":
      default:
        return "Ready";
    }
  }

  let transport = $state<VoiceTransportMode>("websocket");
  let sfuEnabled = $state(false);
  let sttModel = $state<SttModel>("flux");
  let llmModel = $state<LlmModel>("glm");
  let textInput = $state("");
  let webrtcState = $state("new");
  let scrollContainer: HTMLElement | undefined;
  let sfuAudioInput: SFUAudioInput | undefined;
  const sessionId = getSessionId();
  const sessionShortId = sessionId.slice(0, 8);

  // This example uses an explicit controller because changing the model query
  // requires replacing the voice connection. Use createVoiceAgent(...) for
  // one-shot component setup where options do not change.
  let voice = $state.raw(createVoiceController());

  function createVoiceController(): VoiceAgent {
    sfuAudioInput =
      transport === "webrtc"
        ? new SFUAudioInput((state) => {
            webrtcState = state;
          })
        : undefined;

    return new VoiceAgent({
      agent: "MyVoiceAgent",
      name: sessionId,
      query: { model: sttModel, llm: llmModel },
      audioInput: sfuAudioInput,
    });
  }

  function reconnectVoice() {
    voice.close();
    sfuAudioInput?.stop();
    voice = createVoiceController();
  }

  function setTransport(mode: VoiceTransportMode) {
    if (isInCall || transport === mode) return;
    transport = mode;
    webrtcState = mode === "webrtc" ? "new" : "disabled";
    reconnectVoice();
  }

  function setSttModel(model: SttModel) {
    if (isInCall || sttModel === model) return;
    sttModel = model;
    reconnectVoice();
  }

  function setLlmModel(model: LlmModel) {
    if (isInCall || llmModel === model) return;
    llmModel = model;
    reconnectVoice();
  }

  const isInCall = $derived(voice.status !== "idle");
  const isBusy = $derived(voice.status === "thinking");
  const canUseWebRTC = $derived(sfuEnabled);
  const canStartCall = $derived(voice.connected && !isInCall);
  const canSend = $derived(voice.connected && !isBusy && Boolean(textInput.trim()));
  const statusText = $derived(statusLabel(voice.status));
  const audioLevelWidth = $derived(`${Math.min(voice.audioLevel * 500, 100)}%`);

  onMount(() => {
    fetch("/sfu/config")
      .then((response) => response.json() as Promise<{ enabled: boolean }>)
      .then((config) => {
        sfuEnabled = config.enabled;
      })
      .catch(() => {
        sfuEnabled = false;
      });
  });

  $effect(() => {
    voice.transcript.length;
    voice.interimTranscript;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  onDestroy(() => {
    voice.close();
  });

  function startCall() {
    if (!canStartCall) return;
    voice.startCall();
  }

  function toggleMute() {
    voice.toggleMute();
  }

  function endCall() {
    voice.endCall();
  }

  function send() {
    const text = textInput.trim();
    if (!canSend) return;
    voice.sendText(text);
    textInput = "";
  }
</script>

<svelte:head>
  <title>Voice Agent · cloudflare-agents-svelte</title>
</svelte:head>

<div class="shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="title-row">
        <h1>Voice Agent</h1>
        <div class="badge">Svelte</div>
      </div>

      <div class="header-actions">
        <div class:online={voice.connected} class="connection">
          <span></span>
          {voice.connected ? "Connected" : "Connecting"}
        </div>
      </div>
    </div>
  </header>

  <div class="subbar">
    <div class="subbar-inner">
      <div class="usage-group">
        <code>Session: {sessionShortId} · {transport === "webrtc" ? "WebRTC/SFU" : "WebSocket"} voice</code>
        <div class="usage-meta">
          <span>Transport {transport === "webrtc" ? webrtcState : "direct"}</span>
          <span>STT {sttModel === "nova-3" ? "Nova 3" : "Flux"}</span>
          <span>LLM {llmModel}</span>
          {#if voice.metrics}
            <strong>{voice.metrics.first_audio_ms}ms first audio</strong>
          {/if}
        </div>
      </div>
      <div class="route-meta">
        <span>{statusText}</span>
      </div>
    </div>
  </div>

  <main class="messages" aria-live="polite">
    <div class="messages-inner">
      <section class="controls-card" aria-label="Voice model controls">
        <div class="selector-row">
          <span>Transport</span>
          <div class="selector-actions">
            <button
              class:active={transport === "websocket"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setTransport("websocket")}
            >
              WebSocket
            </button>
            <button
              class:active={transport === "webrtc"}
              class="pill"
              type="button"
              disabled={isInCall || !canUseWebRTC}
              title={canUseWebRTC
                ? "Use Cloudflare Realtime SFU"
                : "Set CLOUDFLARE_REALTIME_SFU_APP_ID and CLOUDFLARE_REALTIME_SFU_API_TOKEN to enable WebRTC/SFU"}
              onclick={() => setTransport("webrtc")}
            >
              WebRTC/SFU
            </button>
          </div>
        </div>

        <div class="selector-row">
          <span>STT model</span>
          <div class="selector-actions">
            <button
              class:active={sttModel === "flux"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setSttModel("flux")}
            >
              Flux
            </button>
            <button
              class:active={sttModel === "nova-3"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setSttModel("nova-3")}
            >
              Nova 3
            </button>
          </div>
        </div>

        <div class="selector-row">
          <span>LLM</span>
          <div class="selector-actions">
            <button
              class:active={llmModel === "glm"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setLlmModel("glm")}
            >
              GLM
            </button>
            <button
              class:active={llmModel === "gpt-oss-20b"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setLlmModel("gpt-oss-20b")}
            >
              GPT-OSS 20B
            </button>
            <button
              class:active={llmModel === "kimi"}
              class="pill"
              type="button"
              disabled={isInCall}
              onclick={() => setLlmModel("kimi")}
            >
              Kimi
            </button>
          </div>
        </div>
      </section>

      <section class:active={isInCall} class="status-card">
        <div class="status-icon">{voice.status === "speaking" ? "◖" : "●"}</div>
        <h2>{statusText}</h2>
        <p>
          {isInCall
            ? voice.status === "listening"
              ? "Start speaking or type a message below."
              : "The voice pipeline is processing the conversation."
            : voice.connected
              ? "Click Start Call to talk with the agent."
              : "Connecting to the agent..."}
        </p>

        {#if isInCall && voice.status === "listening"}
          <div class="audio-meter" aria-label="Audio level">
            <div class="audio-meter-fill" style:width={audioLevelWidth}></div>
          </div>
        {/if}
      </section>

      {#if voice.metrics}
        <div class="metrics">
          <span>LLM <strong>{voice.metrics.llm_ms}ms</strong></span>
          <span>TTS <strong>{voice.metrics.tts_ms}ms</strong></span>
          <span>First audio <strong>{voice.metrics.first_audio_ms}ms</strong></span>
        </div>
      {/if}

      <section bind:this={scrollContainer} class="transcript" aria-label="Transcript">
        {#if voice.transcript.length === 0 && !voice.interimTranscript}
          <div class="empty">
            <div class="empty-icon">✦</div>
            <h2>Start a voice conversation</h2>
            <p>
              The agent can answer questions, set spoken reminders, and check
              the weather using tools.
            </p>
          </div>
        {:else}
          {#each voice.transcript as message, index (`${message.timestamp}-${index}`)}
            <article class:user={message.role === "user"} class="message">
              <div class="bubble">
                <p>{message.text || "..."}</p>
                {#if message.timestamp}
                  <time>{formatTime(message.timestamp)}</time>
                {/if}
              </div>
            </article>
          {/each}

          {#if voice.interimTranscript}
            <article class="message user interim-message">
              <div class="bubble">
                <p>{voice.interimTranscript}</p>
              </div>
            </article>
          {/if}
        {/if}
      </section>

      {#if voice.error}
        <div class="error" role="alert">{voice.error}</div>
      {/if}
    </div>
  </main>

  <footer class="composer-wrap">
    <div class="composer">
      <div class="call-controls">
        {#if !isInCall}
          <button type="button" disabled={!canStartCall} onclick={startCall}>
            {voice.connected
              ? transport === "webrtc"
                ? "Start WebRTC Call"
                : "Start Call"
              : "Connecting..."}
          </button>
        {:else}
          <button class="ghost" type="button" onclick={toggleMute}>
            {voice.isMuted ? "Unmute" : "Mute"}
          </button>
          <button class="secondary" type="button" onclick={endCall}>
            End Call
          </button>
        {/if}
      </div>

      <form
        class="text-composer"
        onsubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          bind:value={textInput}
          disabled={!voice.connected || isBusy}
          placeholder={voice.connected ? "Type a message..." : "Connecting..."}
          aria-label="Message"
        />
        <button
          class="ghost"
          type="submit"
          disabled={!canSend}
        >
          Send
        </button>
      </form>
    </div>
  </footer>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body),
  :global(#app) {
    width: 100%;
    height: 100%;
    margin: 0;
  }

  :global(body) {
    color: #111827;
    background: #f8fafc;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #f8fafc;
  }

  .topbar {
    flex: none;
    border-bottom: 1px solid #e5e7eb;
    background: #ffffff;
  }

  .topbar-inner,
  .subbar-inner,
  .messages-inner,
  .composer {
    width: min(100%, 768px);
    margin: 0 auto;
  }

  .topbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  h2 {
    font-size: 1.25rem;
  }

  .title-row,
  .header-actions,
  .selector-actions,
  .call-controls,
  .text-composer {
    display: flex;
    align-items: center;
  }

  .title-row {
    gap: 0.75rem;
  }

  .badge {
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    color: #4b5563;
    background: #f9fafb;
    font-size: 0.75rem;
    font-weight: 650;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: #6b7280;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .connection span {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: #f59e0b;
  }

  .connection.online span {
    background: #10b981;
  }

  .subbar {
    flex: none;
    border-bottom: 1px solid #e5e7eb;
    background: #f9fafb;
  }

  .subbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 1.25rem;
  }

  .route-meta,
  .usage-meta,
  .metrics {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .subbar span {
    color: #6b7280;
    font-size: 0.75rem;
  }

  .usage-meta span + span::before,
  .usage-meta strong::before {
    content: "·";
    margin-right: 0.5rem;
    color: #d1d5db;
  }

  .usage-group {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .usage-group code {
    overflow: hidden;
    max-width: 22rem;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-meta {
    color: #6b7280;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .usage-meta strong {
    color: #111827;
    font-size: 0.75rem;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .messages-inner {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem 1.25rem;
  }

  .controls-card,
  .status-card,
  .transcript {
    border: 1px solid #e5e7eb;
    border-radius: 1rem;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  }

  .controls-card {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
  }

  .selector-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .selector-row > span {
    color: #6b7280;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .selector-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .status-card {
    display: grid;
    justify-items: center;
    padding: 1.5rem;
    color: #6b7280;
    text-align: center;
  }

  .status-card.active .status-icon {
    color: #2563eb;
  }

  .status-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    margin-bottom: 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    color: #10b981;
    background: #ffffff;
    box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
  }

  .status-card h2 {
    margin-bottom: 0.5rem;
    color: #111827;
  }

  .status-card p {
    max-width: 34rem;
    line-height: 1.6;
  }

  .audio-meter {
    width: min(100%, 28rem);
    height: 0.375rem;
    margin-top: 1rem;
    overflow: hidden;
    border-radius: 999px;
    background: #e5e7eb;
  }

  .audio-meter-fill {
    height: 100%;
    border-radius: inherit;
    background: #2563eb;
    transition: width 75ms ease;
  }

  .metrics {
    justify-content: center;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
  }

  .metrics strong {
    color: #111827;
  }

  .transcript {
    flex: 1;
    min-height: 18rem;
    overflow-y: auto;
    padding: 1rem;
  }

  .empty {
    display: grid;
    min-height: 16rem;
    place-content: center;
    justify-items: center;
    color: #6b7280;
    text-align: center;
  }

  .empty-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    margin-bottom: 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    color: #2563eb;
    background: #ffffff;
    box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
  }

  .empty h2 {
    margin-bottom: 0.5rem;
    color: #111827;
  }

  .empty p {
    max-width: 34rem;
    line-height: 1.6;
  }

  .message {
    display: flex;
    margin-bottom: 1rem;
  }

  .message.user {
    justify-content: flex-end;
  }

  .bubble {
    width: min(85vw, 34rem);
    border: 1px solid #e5e7eb;
    border-radius: 1rem 1rem 1rem 0.25rem;
    padding: 0.75rem 1rem;
    color: #111827;
    background: #ffffff;
    line-height: 1.6;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  }

  .user .bubble {
    border-color: #111827;
    border-bottom-right-radius: 0.25rem;
    border-bottom-left-radius: 1rem;
    color: #ffffff;
    background: #111827;
  }

  .interim-message .bubble {
    border-style: dashed;
    opacity: 0.75;
  }

  time {
    display: block;
    margin-top: 0.35rem;
    color: #9ca3af;
    font-size: 0.6875rem;
  }

  .user time {
    color: #d1d5db;
  }

  .error {
    border: 1px solid #fecaca;
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    color: #991b1b;
    background: #fef2f2;
  }

  .composer-wrap {
    flex: none;
    border-top: 1px solid #e5e7eb;
    background: #ffffff;
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
  }

  .call-controls,
  .text-composer {
    gap: 0.75rem;
  }

  .text-composer {
    width: 100%;
  }

  input {
    flex: 1;
    min-height: 2.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.875rem;
    padding: 0.75rem 0.875rem;
    color: #111827;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
    font: inherit;
    line-height: 1.4;
    outline: none;
  }

  input:focus {
    border-color: transparent;
    box-shadow:
      0 0 0 2px #93c5fd,
      0 1px 2px rgb(15 23 42 / 4%);
  }

  button {
    flex: none;
    border: 0;
    border-radius: 0.875rem;
    padding: 0.75rem 1rem;
    color: #ffffff;
    background: #111827;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  button.ghost,
  button.secondary,
  button.pill {
    border: 1px solid #e5e7eb;
    color: #111827;
    background: #ffffff;
  }

  button.pill {
    border-radius: 999px;
    padding: 0.45rem 0.75rem;
    color: #4b5563;
    font-size: 0.75rem;
  }

  button.pill.active {
    border-color: #111827;
    color: #ffffff;
    background: #111827;
  }

  button:disabled,
  input:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (max-width: 640px) {
    .topbar-inner {
      align-items: flex-start;
      flex-direction: column;
    }

    .header-actions,
    .subbar-inner,
    .selector-row,
    .call-controls,
    .text-composer {
      width: 100%;
      justify-content: space-between;
    }

    .subbar-inner,
    .selector-row,
    .text-composer {
      align-items: flex-start;
      flex-direction: column;
    }

    .selector-actions,
    .call-controls,
    .text-composer button {
      width: 100%;
    }

    .selector-actions button,
    .call-controls button,
    .text-composer button {
      flex: 1;
    }

    input {
      width: 100%;
    }
  }
</style>
