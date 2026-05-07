import { Agent, routeAgentRequest, type Connection, type WSMessage } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAINova3STT,
  WorkersAITTS,
  type StreamingTTSProvider,
  type Transcriber,
  type TTSProvider,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import { stepCountIs, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { ElevenLabsTTS } from "./elevenlabs-tts";
import { handleSFURequest } from "./sfu";

const VoiceAgent = withVoice(Agent);

const SYSTEM_PROMPT = `You are a helpful voice assistant running on Cloudflare Workers. Keep your responses concise and conversational — you're being spoken aloud, not read. Aim for 1-3 sentences unless the user asks for more detail. Be warm and natural.

You have tools available:
- get_current_time: Tell the user the current date and time
- set_reminder: Set a spoken reminder after a delay (e.g. "remind me in 5 minutes to check the oven")
- get_weather: Check the weather for a location

Use tools when the user's request matches. After calling a tool, incorporate the result naturally into your spoken response.`;

type Env = {
  AI: Ai;
  MyVoiceAgent: DurableObjectNamespace<MyVoiceAgent>;
  CLOUDFLARE_REALTIME_SFU_APP_ID?: string;
  CLOUDFLARE_REALTIME_SFU_API_TOKEN?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL_ID?: string;
};

function createTTS(env: Env): TTSProvider & Partial<StreamingTTSProvider> {
  if (env.ELEVENLABS_API_KEY) {
    return new ElevenLabsTTS({
      apiKey: env.ELEVENLABS_API_KEY,
      voiceId: env.ELEVENLABS_VOICE_ID,
      modelId: env.ELEVENLABS_MODEL_ID,
    });
  }
  return new WorkersAITTS(env.AI);
}

export class MyVoiceAgent extends VoiceAgent<Env> {
  tts = createTTS(this.env);

  #activeSpeakerId: string | null = null;

  createTranscriber(connection: Connection): Transcriber {
    const url = new URL(connection.uri ?? "http://localhost");
    const model = url.searchParams.get("model");
    if (model === "flux") {
      return new WorkersAIFluxSTT(this.env.AI);
    }
    return new WorkersAINova3STT(this.env.AI);
  }

  beforeCallStart(connection: Connection): boolean {
    if (this.#activeSpeakerId && this.#activeSpeakerId !== connection.id) {
      connection.send(
        JSON.stringify({
          type: "error",
          error:
            "Another session is currently the active speaker. End that call before starting a new one.",
        }),
      );
      return false;
    }
    this.#activeSpeakerId = connection.id;
    return true;
  }

  onCallEnd(connection: Connection) {
    if (this.#activeSpeakerId === connection.id) {
      this.#activeSpeakerId = null;
    }
  }

  onClose(connection: Connection) {
    if (this.#activeSpeakerId === connection.id) {
      this.#activeSpeakerId = null;
    }
  }

  onMessage(_connection: Connection, _message: WSMessage) {
    // Voice protocol messages are intercepted by the mixin. This example keeps
    // non-voice messages unused, but defines the hook to mirror the upstream
    // example's extension point.
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const workersAi = createWorkersAI({ binding: this.env.AI });

    const url = new URL(context.connection.uri ?? "http://localhost");
    const llm = url.searchParams.get("llm");
    const llmModel =
      url.searchParams.get("e2e") === "true"
        ? "@cf/google/gemma-4-26b-a4b-it"
        : llm === "kimi"
          ? "@cf/moonshotai/kimi-k2.6"
          : llm === "gpt-oss-20b"
            ? "@cf/openai/gpt-oss-20b"
            : "@cf/zai-org/glm-4.7-flash";

    const result = streamText({
      model: workersAi(llmModel as Parameters<typeof workersAi>[0], {
        sessionAffinity: this.sessionAffinity,
      }),
      system: SYSTEM_PROMPT,
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: transcript },
      ],
      tools: {
        get_current_time: tool({
          description: "Get the current date and time. Use when the user asks what time it is.",
          inputSchema: z.object({}),
          execute: async () => {
            const now = new Date();
            return {
              time: now.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              }),
              date: now.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
            };
          },
        }),
        set_reminder: tool({
          description: "Set a reminder that will be spoken aloud after a delay.",
          inputSchema: z.object({
            message: z.string().describe("The reminder message to speak to the user"),
            delay_seconds: z.number().describe("How many seconds from now to trigger the reminder"),
          }),
          execute: async ({ message, delay_seconds }) => {
            await this.schedule(delay_seconds, "speakReminder", { message });
            const minutes = Math.round(delay_seconds / 60);
            const timeLabel =
              minutes >= 1
                ? `${minutes} minute${minutes > 1 ? "s" : ""}`
                : `${delay_seconds} seconds`;
            return { confirmed: true, message, delay: timeLabel };
          },
        }),
        get_weather: tool({
          description:
            "Get the current weather for a location. Use when the user asks about the weather.",
          inputSchema: z.object({
            location: z.string().describe("The city or location to check weather for"),
          }),
          execute: async ({ location }) => {
            const conditions = ["sunny", "partly cloudy", "overcast", "light rain"];
            const condition = conditions[Math.floor(Math.random() * conditions.length)];
            const temp = Math.floor(55 + Math.random() * 35);
            return {
              location,
              temperature: `${temp}°F`,
              condition,
              note: "Mock data — connect a weather MCP server for real forecasts.",
            };
          },
        }),
      },
      stopWhen: stepCountIs(3),
      abortSignal: context.signal,
    });

    return result.textStream;
  }

  async onCallStart(connection: Connection) {
    const messageCount =
      this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM cf_voice_messages
    `[0]?.count ?? 0;

    const greeting =
      messageCount > 0
        ? "Welcome back! How can I help you today?"
        : "Hi there! I'm your voice assistant. I can answer questions, set reminders, or check the weather. What can I do for you?";

    await this.speak(connection, greeting);
  }

  async speakReminder(payload: { message: string }) {
    await this.speakAll(`Reminder: ${payload.message}`);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/sfu/")) {
      const appId = env.CLOUDFLARE_REALTIME_SFU_APP_ID;
      const apiToken = env.CLOUDFLARE_REALTIME_SFU_API_TOKEN;

      if (url.pathname === "/sfu/config") {
        return Response.json({ enabled: Boolean(appId && apiToken) });
      }

      if (!appId || !apiToken) {
        return Response.json({ error: "SFU credentials not configured" }, { status: 500 });
      }

      const response = await handleSFURequest(request, {
        appId,
        apiToken,
        agentNamespace: env.MyVoiceAgent,
      });
      if (response) return response;
    }

    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
