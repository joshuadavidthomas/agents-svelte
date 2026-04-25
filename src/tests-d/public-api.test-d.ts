import type * as RootModule from "../index.ts";
import type * as ChatModule from "../chat.ts";
import type * as VoiceModule from "../voice.ts";
import type { Agent, CreateAgentOptions } from "../index.ts";
import type {
  AgentChat,
  AgentChatToolCall,
  CreateAgentChatOptions,
  ToolCallOutputOptions
} from "../chat.ts";
import type {
  VoiceAgent,
  VoiceInput,
  VoiceInputOptions,
  WebSocketVoiceTransport
} from "../voice.ts";

type RootExport = keyof typeof RootModule;
type ChatExport = keyof typeof ChatModule;
type VoiceExport = keyof typeof VoiceModule;

const rootExport: RootExport = "Agent";
const chatExport: ChatExport = "AgentChat";
const voiceExport: VoiceExport = "VoiceAgent";
void rootExport;
void chatExport;
void voiceExport;

declare const agent: Agent;
declare const chat: AgentChat;
declare const toolCall: AgentChatToolCall;
declare const voice: VoiceAgent;
declare const input: VoiceInput;
declare const voiceTransport: WebSocketVoiceTransport;

void agent;
void chat;
void toolCall;
void voice;
void input;
void voiceTransport;

const agentOptions: CreateAgentOptions = { agent: "ChatAgent" };
const chatOptions = {} as CreateAgentChatOptions;
const voiceInputOptions: VoiceInputOptions = {
  agent: "VoiceAgent",
  transport: voiceTransport
};
const outputOptions: ToolCallOutputOptions = { output: { ok: true } };
void agentOptions;
void chatOptions;
void voiceInputOptions;
void outputOptions;

// @ts-expect-error context helpers are intentionally not public
const rootContext: RootExport = "setAgentContext";
void rootContext;

// @ts-expect-error raw tool-part helpers are intentionally not public
const rawToolHelper: ChatExport = "getToolPartState";
void rawToolHelper;

// @ts-expect-error chat transport is intentionally internal
const chatTransport: ChatExport = "AgentChatTransport";
void chatTransport;

// @ts-expect-error voice client internals are intentionally not public
const voiceClient: VoiceExport = "VoiceClient";
void voiceClient;
