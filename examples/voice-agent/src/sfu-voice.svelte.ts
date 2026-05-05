import type { VoiceAudioInput } from "agents-svelte/voice";

const STUN_SERVER = "stun:stun.cloudflare.com:3478";

export type VoiceTransportMode = "websocket" | "webrtc";

/**
 * Example-local WebRTC/SFU audio input.
 *
 * This mirrors Cloudflare's upstream React example and is deliberately not
 * package API yet. It is shaped like a future reusable Svelte/WebRTC voice
 * controller: VoiceAgent still owns protocol, transcript, playback, mute, and
 * VAD behavior; this class swaps only the microphone capture path.
 */
export class SFUAudioInput implements VoiceAudioInput {
  onAudioLevel: ((rms: number) => void) | null = null;
  onAudioData: ((pcm: ArrayBuffer) => void) | null = null;

  #pc: RTCPeerConnection | null = null;
  #stream: MediaStream | null = null;
  #audioCtx: AudioContext | null = null;
  #scriptNode: ScriptProcessorNode | null = null;
  readonly #onWebRTCState: (state: string) => void;

  constructor(onWebRTCState: (state: string) => void) {
    this.#onWebRTCState = onWebRTCState;
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.#stream = stream;

    const sessionResponse = await fetch("/sfu/session", { method: "POST" });
    const sessionData = (await sessionResponse.json()) as {
      sessionId: string;
    };

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: STUN_SERVER }],
      bundlePolicy: "max-bundle",
    });
    this.#pc = pc;

    pc.oniceconnectionstatechange = () => {
      this.#onWebRTCState(pc.iceConnectionState);
    };

    const audioTrack = stream.getAudioTracks()[0];
    pc.addTransceiver(audioTrack, { direction: "sendonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const tracksResponse = await fetch("/sfu/tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionData.sessionId,
        tracks: {
          sessionDescription: {
            type: "offer",
            sdp: offer.sdp,
          },
          tracks: [
            {
              location: "local",
              trackName: "mic-audio",
              mid: pc.getTransceivers()[0].mid,
            },
          ],
        },
      }),
    });
    const tracksData = (await tracksResponse.json()) as {
      sessionDescription?: { sdp: string };
    };

    if (tracksData.sessionDescription) {
      await pc.setRemoteDescription({
        type: "answer",
        sdp: tracksData.sessionDescription.sdp,
      });
    }

    this.#audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = this.#audioCtx.createMediaStreamSource(stream);
    const scriptNode = this.#audioCtx.createScriptProcessor(4096, 1, 1);
    this.#scriptNode = scriptNode;

    scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const samples = event.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }
      this.onAudioLevel?.(Math.sqrt(sum / samples.length));

      if (!this.onAudioData) return;
      const pcm = new ArrayBuffer(samples.length * 2);
      const view = new DataView(pcm);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      this.onAudioData(pcm);
    };

    source.connect(scriptNode);
    scriptNode.connect(this.#audioCtx.destination);
  }

  stop(): void {
    this.#scriptNode?.disconnect();
    this.#scriptNode = null;
    this.#pc?.close();
    this.#pc = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#audioCtx?.close().catch(() => {});
    this.#audioCtx = null;
    this.#onWebRTCState("closed");
  }
}
