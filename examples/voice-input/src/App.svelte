<script lang="ts">
  import { onDestroy } from "svelte";
  import { createVoiceInput } from "@joshthomas/cloudflare-agents-svelte/voice";

  const voice = createVoiceInput({ agent: "VoiceInputAgent" });

  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | undefined;

  const displayText = $derived(
    voice.transcript +
      (voice.interimTranscript
        ? `${voice.transcript ? " " : ""}${voice.interimTranscript}`
        : ""),
  );
  const audioLevelWidth = $derived(`${Math.min(voice.audioLevel * 500, 100)}%`);

  onDestroy(() => {
    if (copyTimeout) clearTimeout(copyTimeout);
  });

  async function copyText() {
    if (!displayText) return;
    await navigator.clipboard.writeText(displayText);
    copied = true;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copied = false;
      copyTimeout = undefined;
    }, 2000);
  }
</script>

<svelte:head>
  <title>Voice Input · cloudflare-agents-svelte</title>
</svelte:head>

<div class="shell">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="title-row">
        <h1>Voice Input</h1>
        <div class="badge">Svelte</div>
      </div>

      <div class="header-actions">
        <div class:online={voice.isListening} class="connection">
          <span></span>
          {voice.isListening ? "Listening" : "Ready"}
        </div>
      </div>
    </div>
  </header>

  <div class="subbar">
    <div class="subbar-inner">
      <div class="usage-group">
        <code>Workers AI Nova 3 STT</code>
        <div class="usage-meta">
          <span>Voice-to-text dictation</span>
          <span>{voice.isMuted ? "Muted" : "Mic active"}</span>
        </div>
      </div>
      <div class="route-meta">
        <span>{voice.error ? "Error" : voice.isListening ? "Streaming audio" : "Idle"}</span>
      </div>
    </div>
  </div>

  <main class="content" aria-live="polite">
    <div class="content-inner">
      <section class="empty info-card" aria-labelledby="voice-input-title">
        <div class="empty-icon">🎙️</div>
        <h2 id="voice-input-title">Voice-to-Text Dictation</h2>
        <p>
          Click the microphone to start dictating. Your speech is transcribed in
          real time using Workers AI and displayed below.
        </p>
      </section>

      <section class="dictation-card" aria-label="Dictation transcript">
        <div class="transcript">
          {#if displayText}
            <p>
              {voice.transcript}{#if voice.interimTranscript}<span class="interim"
                  >{voice.transcript ? " " : ""}{voice.interimTranscript}</span
                >{/if}
            </p>
          {:else}
            <p class="placeholder">
              {voice.isListening
                ? "Listening... start speaking"
                : "Click the microphone button to start dictating"}
            </p>
          {/if}
        </div>

        {#if voice.isListening}
          <div class="audio-meter" aria-label="Audio level">
            <div class="audio-meter-fill" style:width={audioLevelWidth}></div>
          </div>
        {/if}
      </section>

      {#if voice.error}
        <div class="error" role="alert">{voice.error}</div>
      {/if}
    </div>
  </main>

  <footer class="composer-wrap">
    <div class="composer">
      <div class="controls">
        {#if !voice.isListening}
          <button class="primary" type="button" onclick={() => voice.start()}>
            Dictate
          </button>
        {:else}
          <button class="secondary" type="button" onclick={() => voice.stop()}>
            Stop
          </button>
          <button class="ghost" type="button" onclick={() => voice.toggleMute()}>
            {voice.isMuted ? "Unmute" : "Mute"}
          </button>
        {/if}
      </div>

      <div class="controls secondary-controls">
        <button class="ghost" type="button" onclick={copyText} disabled={!displayText}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          class="ghost"
          type="button"
          onclick={() => voice.clear()}
          disabled={!voice.transcript}
        >
          Clear
        </button>
      </div>
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
  .content-inner,
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
    color: #111827;
    font-size: 1.25rem;
  }

  .title-row,
  .header-actions,
  .controls {
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

  .header-actions {
    gap: 0.75rem;
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
    background: #10b981;
  }

  .connection.online span {
    background: #2563eb;
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
  .usage-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .subbar span {
    color: #6b7280;
    font-size: 0.75rem;
  }

  .usage-meta span + span::before {
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
    max-width: 18rem;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .content-inner {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem 1.25rem;
  }

  .empty {
    display: grid;
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
  }

  .empty p {
    max-width: 34rem;
    line-height: 1.6;
  }

  .info-card,
  .dictation-card {
    border: 1px solid #e5e7eb;
    border-radius: 1rem;
    background: #ffffff;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  }

  .info-card {
    padding: 2rem 1.25rem;
  }

  .dictation-card {
    flex: 1;
    min-height: 18rem;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .transcript {
    flex: 1;
    padding: 1rem;
    color: #111827;
    font-size: 0.9375rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .interim,
  .placeholder {
    color: #9ca3af;
    font-style: italic;
  }

  .audio-meter {
    height: 0.375rem;
    margin: 0 1rem 1rem;
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
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
  }

  .controls {
    gap: 0.5rem;
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
  button.secondary {
    border: 1px solid #e5e7eb;
    color: #111827;
    background: #ffffff;
  }

  button:disabled {
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
    .composer {
      width: 100%;
      justify-content: space-between;
    }

    .subbar-inner,
    .composer {
      align-items: flex-start;
      flex-direction: column;
    }

    .controls {
      width: 100%;
    }

    .controls button {
      flex: 1;
    }
  }
</style>
