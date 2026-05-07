import type { StreamingTTSProvider, TTSProvider } from "@cloudflare/voice";

export interface ElevenLabsTTSOptions {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

export class ElevenLabsTTS implements TTSProvider, StreamingTTSProvider {
  readonly #apiKey: string;
  readonly #voiceId: string;
  readonly #modelId: string;
  readonly #outputFormat: string;

  constructor(options: ElevenLabsTTSOptions) {
    this.#apiKey = options.apiKey;
    this.#voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
    this.#modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.#outputFormat = options.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(this.#url(), {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ text, model_id: this.#modelId }),
        signal,
      });

      if (!response.ok) {
        console.error(`[ElevenLabsTTS] Error: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error("[ElevenLabsTTS] Error:", error);
      return null;
    }
  }

  async *synthesizeStream(text: string, signal?: AbortSignal): AsyncGenerator<ArrayBuffer> {
    try {
      const response = await fetch(this.#url("stream"), {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ text, model_id: this.#modelId }),
        signal,
      });

      if (!response.ok || !response.body) {
        console.error(`[ElevenLabsTTS] Stream error: ${response.status} ${response.statusText}`);
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > 0) {
          yield value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        }
      }
    } catch (error) {
      console.error("[ElevenLabsTTS] Stream error:", error);
    }
  }

  #url(mode?: "stream"): string {
    const suffix = mode === "stream" ? "/stream" : "";
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${this.#voiceId}${suffix}`);
    url.searchParams.set("output_format", this.#outputFormat);
    return url.toString();
  }

  #headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "xi-api-key": this.#apiKey,
    };
  }
}
