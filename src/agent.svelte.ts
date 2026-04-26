import { onDestroy } from "svelte";
import PartySocket from "partysocket";
import type {
  AgentPromiseReturnType,
  AgentStub,
  OptionalAgentMethods,
  RequiredAgentMethods,
  StreamOptions,
  UntypedAgentStub
} from "agents/client";
import { createStubProxy } from "agents/client";
import type { MCPServersState, RPCRequest, RPCResponse } from "agents";
import { MessageType } from "agents/types";
import { camelCaseToKebabCase } from "./utils.ts";

type QueryObject = Record<string, string | null>;

type AgentRouteSegment = {
  agent: string;
  name: string;
};

type SubAgentRoute = AgentRouteSegment;

export interface CreateAgentOptions {
  agent: string;
  name?: string;
  host?: string;
  basePath?: string;
  path?: string;
  query?: QueryObject | (() => QueryObject | Promise<QueryObject>);
  protocol?: "ws" | "wss";
  protocols?: string[];
  id?: string;
  prefix?: string;
  sub?: ReadonlyArray<SubAgentRoute>;
}

type OptionalArgsCall<AgentT> = <K extends keyof OptionalAgentMethods<AgentT>>(
  method: K,
  args?: Parameters<OptionalAgentMethods<AgentT>[K]>,
  stream?: StreamOptions
) => AgentPromiseReturnType<AgentT, K>;

type RequiredArgsCall<AgentT> = <K extends keyof RequiredAgentMethods<AgentT>>(
  method: K,
  args: Parameters<RequiredAgentMethods<AgentT>[K]>,
  stream?: StreamOptions
) => AgentPromiseReturnType<AgentT, K>;

type TypedCall<AgentT> = OptionalArgsCall<AgentT> & RequiredArgsCall<AgentT>;

type UntypedCall = <T = unknown>(
  method: string,
  args?: unknown[],
  stream?: StreamOptions
) => Promise<T>;

export interface Identity {
  name: string;
  agent: string;
  identified: boolean;
}

export interface StateUpdate<State = unknown> {
  state: State;
  source: "server" | "client";
  seq: number;
}

export interface IdentityChange {
  oldIdentity: Identity;
  newIdentity: Identity;
  seq: number;
}

export class Agent<AgentT = unknown, State = unknown> {
  readonly socket: PartySocket;
  readonly path: ReadonlyArray<AgentRouteSegment>;

  state = $state<State | undefined>(undefined);
  identity = $state<Identity>({
    name: "default",
    agent: "",
    identified: false
  });
  connected = $state(false);
  stateError = $state<string | null>(null);
  mcp = $state<MCPServersState | null>(null);
  lastStateUpdate = $state<StateUpdate<State> | null>(null);
  lastIdentityChange = $state<IdentityChange | null>(null);

  readonly stub: AgentT extends object ? AgentStub<AgentT> : UntypedAgentStub;

  readonly call: AgentT extends object ? TypedCall<AgentT> : UntypedCall;

  readonly #pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      stream?: StreamOptions;
    }
  >();
  #previousIdentity: { name: string | null; agent: string | null } = {
    name: null,
    agent: null
  };
  #eventSeq = 0;
  readonly #httpUrl: string;

  constructor(options: CreateAgentOptions) {
    const agentNamespace = camelCaseToKebabCase(options.agent);
    const roomName = options.name ?? "default";
    const prefix = options.prefix ?? "agents";
    const subPath = options.sub
      ?.map(
        (sub) =>
          `sub/${camelCaseToKebabCase(sub.agent)}/${encodeURIComponent(sub.name)}`
      )
      .join("/");
    this.path = [
      { agent: agentNamespace, name: roomName },
      ...(options.sub?.map((sub) => ({
        agent: camelCaseToKebabCase(sub.agent),
        name: sub.name
      })) ?? [])
    ];

    if (agentNamespace !== agentNamespace.toLowerCase()) {
      console.warn(
        `[cloudflare-agents-svelte] Agent namespace should be lowercase. Got: ${agentNamespace}`
      );
    }

    this.identity = {
      name: this.path.at(-1)?.name ?? roomName,
      agent: this.path.at(-1)?.agent ?? agentNamespace,
      identified: false
    };

    let host = options.host;
    if (!host) {
      if (typeof window === "undefined") {
        throw new Error(
          "[cloudflare-agents-svelte] `host` is required when not running in a browser"
        );
      }
      host = window.location.host;
    }
    const baseSocketOpts = {
      host,
      id: options.id,
      path: options.path,
      protocol: options.protocol,
      protocols: options.protocols,
      query: options.query
    };
    const routingOpts = options.basePath
      ? { basePath: options.basePath }
      : {
          party: agentNamespace,
          prefix,
          room: roomName
        };

    let normalizedHost = host.replace(/^(http|https|ws|wss):\/\//, "");
    normalizedHost = normalizedHost.endsWith("/")
      ? normalizedHost.slice(0, -1)
      : normalizedHost;
    if (options.path?.startsWith("/")) {
      throw new Error("path must not start with a slash");
    }
    const socketProtocol =
      options.protocol ??
      (normalizedHost.startsWith("localhost:") ||
      normalizedHost.startsWith("127.0.0.1:") ||
      normalizedHost.startsWith("192.168.") ||
      normalizedHost.startsWith("10.") ||
      (normalizedHost.startsWith("172.") &&
        normalizedHost.split(".")[1] >= "16" &&
        normalizedHost.split(".")[1] <= "31") ||
      normalizedHost.startsWith("[::ffff:7f00:1]:")
        ? "ws"
        : "wss");
    const httpProtocol = socketProtocol === "wss" ? "https" : "http";
    const path = options.path ? `/${options.path}` : "";
    const route = options.basePath
      ? options.basePath
      : [prefix, agentNamespace, roomName, subPath].filter(Boolean).join("/");
    this.#httpUrl = `${httpProtocol}://${normalizedHost}/${route}${path}`;

    const socketOpts = subPath
      ? { ...baseSocketOpts, basePath: route }
      : { ...baseSocketOpts, ...routingOpts };

    this.socket = new PartySocket(socketOpts);
    this.socket.addEventListener("message", this.#handleMessage);
    this.socket.addEventListener("open", this.#handleOpen);
    this.socket.addEventListener("close", this.#handleClose);
    this.socket.addEventListener("error", this.#handleError);

    this.call = this.#call as Agent<AgentT, State>["call"];
    this.stub = createStubProxy(this.#call as UntypedCall) as Agent<
      AgentT,
      State
    >["stub"];
  }

  setState(next: State): void {
    this.socket.send(
      JSON.stringify({ type: MessageType.CF_AGENT_STATE, state: next })
    );
    this.state = next;
    this.lastStateUpdate = {
      state: next,
      source: "client",
      seq: ++this.#eventSeq
    };
  }

  getHttpUrl(): string {
    return this.#httpUrl;
  }

  close(): void {
    this.socket.removeEventListener("message", this.#handleMessage);
    this.socket.removeEventListener("open", this.#handleOpen);
    this.socket.removeEventListener("close", this.#handleClose);
    this.socket.removeEventListener("error", this.#handleError);
    this.socket.close();
  }

  #handleOpen = (_e: Event) => {
    this.connected = true;
  };

  #handleMessage = (e: MessageEvent) => {
    if (typeof e.data !== "string") {
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case MessageType.CF_AGENT_IDENTITY: {
        const newName = msg.name as string;
        const newAgent = msg.agent as string;
        const oldName = this.#previousIdentity.name;
        const oldAgent = this.#previousIdentity.agent;

        const newIdentity = {
          name: newName,
          agent: newAgent,
          identified: true
        } satisfies Identity;
        this.identity = newIdentity;

        if (
          oldName !== null &&
          oldAgent !== null &&
          (oldName !== newName || oldAgent !== newAgent)
        ) {
          this.lastIdentityChange = {
            oldIdentity: {
              name: oldName,
              agent: oldAgent,
              identified: true
            },
            newIdentity,
            seq: ++this.#eventSeq
          };
        }

        this.#previousIdentity = { name: newName, agent: newAgent };
        return;
      }

      case MessageType.CF_AGENT_STATE:
        this.state = msg.state as State;
        this.lastStateUpdate = {
          state: this.state as State,
          source: "server",
          seq: ++this.#eventSeq
        };
        return;

      case MessageType.CF_AGENT_STATE_ERROR:
        this.stateError = msg.error as string;
        return;

      case MessageType.CF_AGENT_MCP_SERVERS:
        this.mcp = msg.mcp as MCPServersState;
        return;

      case MessageType.RPC: {
        const r = msg as unknown as RPCResponse;
        const p = this.#pending.get(r.id);
        if (!p) return;
        if (!r.success) {
          this.#pending.delete(r.id);
          p.reject(new Error(r.error));
          p.stream?.onError?.(r.error);
          return;
        }
        if ("done" in r) {
          if (r.done) {
            this.#pending.delete(r.id);
            p.resolve(r.result);
            p.stream?.onDone?.(r.result);
          } else {
            p.stream?.onChunk?.(r.result);
          }
        } else {
          this.#pending.delete(r.id);
          p.resolve(r.result);
        }
        return;
      }
    }
  };

  #handleClose = (_e: CloseEvent) => {
    this.connected = false;
    this.identity = { ...this.identity, identified: false };

    const err = new Error("Connection closed");
    for (const p of this.#pending.values()) {
      p.reject(err);
      p.stream?.onError?.("Connection closed");
    }
    this.#pending.clear();
  };

  #handleError = (_e: Event) => {};

  #call = <T>(
    method: string,
    args: unknown[] = [],
    stream?: StreamOptions
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.#pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        stream
      });
      const req: RPCRequest = {
        type: MessageType.RPC,
        id,
        method,
        args
      };
      this.socket.send(JSON.stringify(req));
    });
  };
}

export function createAgent<AgentT = unknown, State = unknown>(
  options: CreateAgentOptions
): Agent<AgentT, State> {
  const agent = new Agent<AgentT, State>(options);
  onDestroy(() => agent.close());
  return agent;
}
