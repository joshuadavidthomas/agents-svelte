import type * as RootModule from "../index.ts";
import type * as ChatModule from "../chat.ts";
import type * as VoiceModule from "../voice.ts";
import type {
  Agent,
  AgentConnectionError,
  CreateAgentOptions,
  Identity,
  IdentityChange,
  QueryObject,
  QueryStatus,
  StateUpdate,
} from "../index.ts";
import type {
  AgentChat,
  AgentChatToolCall,
  AgentToolEvent,
  AgentToolEventMessage,
  AgentToolEventState,
  AgentToolEvents,
  AgentToolInterruptedReason,
  AgentToolRunPart,
  AgentToolRunState,
  ClientToolSchema,
  CreateAgentChatOptions,
  CreateAgentToolEventsOptions,
  PrepareSendMessagesRequestOptions,
  PrepareSendMessagesRequestResult,
  ToolCallOutputOptions,
} from "../chat.ts";
import type {
  TranscriptMessage,
  VoiceAgent,
  VoiceAudioFormat,
  VoiceAudioInput,
  VoiceClientEvent,
  VoiceClientEventMap,
  VoiceClientOptions,
  VoiceInput,
  VoiceInputOptions,
  VoicePipelineMetrics,
  VoiceRole,
  VoiceStatus,
  VoiceTransport,
  WebSocketVoiceTransport,
} from "../voice.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type RootExport = keyof typeof RootModule;
type ChatExport = keyof typeof ChatModule;
type VoiceExport = keyof typeof VoiceModule;

type ExpectedRootExports = "Agent" | "createAgent";
type ExpectedChatExports =
  | "AgentChat"
  | "AgentChatToolCall"
  | "AgentToolEvents"
  | "createAgentChat"
  | "createAgentToolEvents"
  | "getAgentMessages";
type ExpectedVoiceExports =
  | "VoiceAgent"
  | "VoiceInput"
  | "WebSocketVoiceTransport"
  | "createVoiceAgent"
  | "createVoiceInput";

type _RootExportsAreIntentional = Expect<Equal<RootExport, ExpectedRootExports>>;
type _ChatExportsAreIntentional = Expect<Equal<ChatExport, ExpectedChatExports>>;
type _VoiceExportsAreIntentional = Expect<Equal<VoiceExport, ExpectedVoiceExports>>;

declare const agent: Agent;
declare const agentConnectionError: AgentConnectionError;
declare const identity: Identity;
declare const stateUpdate: StateUpdate<unknown>;
declare const identityChange: IdentityChange;
declare const queryObject: QueryObject;
declare const queryStatus: QueryStatus;
declare const chat: AgentChat;
declare const toolCall: AgentChatToolCall;
declare const toolEvents: AgentToolEvents;
declare const agentToolEvent: AgentToolEvent;
declare const agentToolEventMessage: AgentToolEventMessage;
declare const agentToolEventState: AgentToolEventState;
declare const agentToolInterruptedReason: AgentToolInterruptedReason;
declare const agentToolRunPart: AgentToolRunPart;
declare const agentToolRunState: AgentToolRunState;
declare const clientToolSchema: ClientToolSchema;
declare const sendOptions: PrepareSendMessagesRequestOptions;
declare const sendResult: PrepareSendMessagesRequestResult;
declare const voice: VoiceAgent;
declare const input: VoiceInput;
declare const voiceTransport: WebSocketVoiceTransport;
declare const genericVoiceTransport: VoiceTransport;
declare const voiceStatus: VoiceStatus;
declare const voiceRole: VoiceRole;
declare const voiceAudioFormat: VoiceAudioFormat;
declare const voiceAudioInput: VoiceAudioInput;
declare const transcriptMessage: TranscriptMessage;
declare const metrics: VoicePipelineMetrics;
declare const voiceClientOptions: VoiceClientOptions;
declare const voiceClientEvent: VoiceClientEvent;
declare const voiceClientEventMap: VoiceClientEventMap;

void agent;
void agentConnectionError;
void identity;
void stateUpdate;
void identityChange;
void queryObject;
void queryStatus;
void chat;
void toolCall;
void toolEvents;
void agentToolEvent;
void agentToolEventMessage;
void agentToolEventState;
void agentToolInterruptedReason;
void agentToolRunPart;
void agentToolRunState;
void clientToolSchema;
void sendOptions;
void sendResult;
void voice;
void input;
void voiceTransport;
void genericVoiceTransport;
void voiceStatus;
void voiceRole;
void voiceAudioFormat;
void voiceAudioInput;
void transcriptMessage;
void metrics;
void voiceClientOptions;
void voiceClientEvent;
void voiceClientEventMap;

const agentOptions: CreateAgentOptions = { agent: "ChatAgent" };
const agentOptionsWithConnectionError: CreateAgentOptions = {
  agent: "ChatAgent",
  onConnectionError: (error) => {
    const code: number = error.code;
    void code;
  },
};
const chatOptions = {} as CreateAgentChatOptions;
const toolEventsOptions: CreateAgentToolEventsOptions = { agent };
const voiceInputOptions: VoiceInputOptions = {
  agent: "VoiceAgent",
  transport: voiceTransport,
};
const outputOptions: ToolCallOutputOptions = { output: { ok: true } };
void agentOptions;
void agentOptionsWithConnectionError;
void chatOptions;
void toolEventsOptions;
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
