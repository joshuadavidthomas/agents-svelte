import { onDestroy, onMount, untrack } from "svelte";
import type {
  AgentPromiseReturnType,
  AgentStub,
  CallOptions,
  OptionalAgentMethods,
  RequiredAgentMethods,
  StreamOptions,
  UntypedAgentStub,
} from "agents/client";
import { AgentClient, createStubProxy } from "agents/client";
import type { MCPServersState, RPCRequest, RPCResponse } from "agents";
import { MessageType } from "agents/types";
import { camelCaseToKebabCase } from "./utils.ts";

export type QueryObject = Record<string, string | null>;
export type QueryStatus = "idle" | "loading" | "ready" | "error";

interface QueryCacheEntry {
  promise: Promise<QueryObject>;
  expiresAt: number;
}

const DEFAULT_QUERY_CACHE_TTL = 5 * 60 * 1000;
const queryCache = new Map<string, QueryCacheEntry>();

function getCachedQuery(key: string): QueryCacheEntry | undefined {
  const entry = queryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    queryCache.delete(key);
    return undefined;
  }
  return entry;
}

function setCachedQuery(key: string, promise: Promise<QueryObject>, ttl: number): QueryCacheEntry {
  const entry = { promise, expiresAt: Date.now() + ttl };
  queryCache.set(key, entry);
  return entry;
}

function deleteCachedQuery(key: string): void {
  queryCache.delete(key);
}

type AgentRouteSegment = {
  agent: string;
  name: string;
};

type SubAgentRoute = AgentRouteSegment;

function normalizeHost(host: string): string {
  return host.replace(/^(http|https|ws|wss):\/\//, "").replace(/\/$/, "");
}

function hostnameFromHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return host.split(":")[0] ?? host;
  }
}

function isLocalHost(host: string): boolean {
  const hostname = hostnameFromHost(host);
  if (["localhost", "127.0.0.1", "::1", "::ffff:7f00:1"].includes(hostname)) {
    return true;
  }

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

export interface CreateAgentOptions {
  agent: string;
  name?: string;
  host?: string;
  basePath?: string;
  path?: string;
  query?: QueryObject | (() => QueryObject | Promise<QueryObject>);
  cacheTtl?: number;
  protocol?: "ws" | "wss";
  protocols?: string[];
  id?: string;
  prefix?: string;
  sub?: ReadonlyArray<SubAgentRoute>;
  /** Called when the server sends the agent's identity on connect. */
  onIdentity?: (name: string, agent: string) => void;
  /** Called when the server changes identity on reconnect or reroute. */
  onIdentityChange?: (oldName: string, newName: string, oldAgent: string, newAgent: string) => void;
}

type AgentCallOptions = CallOptions | StreamOptions;

type OptionalArgsCall<AgentT> = <K extends keyof OptionalAgentMethods<AgentT>>(
  method: K,
  args?: Parameters<OptionalAgentMethods<AgentT>[K]>,
  options?: AgentCallOptions,
) => AgentPromiseReturnType<AgentT, K>;

type RequiredArgsCall<AgentT> = <K extends keyof RequiredAgentMethods<AgentT>>(
  method: K,
  args: Parameters<RequiredAgentMethods<AgentT>[K]>,
  options?: AgentCallOptions,
) => AgentPromiseReturnType<AgentT, K>;

type TypedCall<AgentT> = OptionalArgsCall<AgentT> & RequiredArgsCall<AgentT>;

type UntypedCall = <T = unknown>(
  method: string,
  args?: unknown[],
  options?: AgentCallOptions,
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
  readonly path: ReadonlyArray<AgentRouteSegment>;

  #connection = $state<{ socket: AgentClient<AgentT, State> | null }>({ socket: null });

  state = $state<State | undefined>(undefined);
  identity = $state<Identity>({
    name: "default",
    agent: "",
    identified: false,
  });
  connected = $state(false);
  queryStatus = $state<QueryStatus>("idle");
  queryError = $state<Error | null>(null);
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
      timeoutId?: ReturnType<typeof setTimeout>;
    }
  >();
  #previousIdentity: { name: string | null; agent: string | null } = {
    name: null,
    agent: null,
  };
  #eventSeq = 0;
  #started = false;
  #connecting = false;
  #connectionGeneration = 0;
  #queryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #options: CreateAgentOptions;
  #httpUrl: string | null = null;
  #currentQuery: QueryObject | undefined;
  #readyPromise!: Promise<void>;
  #resolveReady!: () => void;

  constructor(options: CreateAgentOptions) {
    this.#options = options;
    const agentNamespace = camelCaseToKebabCase(options.agent);
    const roomName = options.name ?? "default";
    this.path = [
      { agent: agentNamespace, name: roomName },
      ...(options.sub?.map((sub) => ({
        agent: camelCaseToKebabCase(sub.agent),
        name: sub.name,
      })) ?? []),
    ];

    this.identity = {
      name: this.path.at(-1)?.name ?? roomName,
      agent: this.path.at(-1)?.agent ?? agentNamespace,
      identified: false,
    };

    if (options.path?.startsWith("/")) {
      throw new Error("path must not start with a slash");
    }

    this.call = this.#call as Agent<AgentT, State>["call"];
    this.stub = createStubProxy(this.#call as UntypedCall) as Agent<AgentT, State>["stub"];
    this.#resetReady();
  }

  get ready(): Promise<void> {
    return this.#readyPromise;
  }

  get socket(): AgentClient<AgentT, State> | null {
    return this.#connection.socket;
  }

  #resolveConnectionOptions(query = this.#currentQuery): {
    host: string;
    route: string;
    subPath?: string;
    httpUrl: string;
  } {
    const options = this.#options;
    const agentNamespace = this.path[0].agent;
    const roomName = this.path[0].name;
    const prefix = options.prefix ?? "agents";
    const subPath = this.path
      .slice(1)
      .map((sub) => `sub/${sub.agent}/${encodeURIComponent(sub.name)}`)
      .join("/");
    let host = options.host;
    if (!host) {
      if (typeof window === "undefined") {
        throw new Error("[agents-svelte] `host` is required outside the browser");
      }
      host = window.location.host;
    }

    const normalizedHost = normalizeHost(host);
    const socketProtocol = options.protocol ?? (isLocalHost(normalizedHost) ? "ws" : "wss");
    const httpProtocol = socketProtocol === "wss" ? "https" : "http";
    const path = options.path ? `/${options.path}` : "";
    const route = options.basePath
      ? options.basePath
      : [prefix, agentNamespace, roomName, subPath].filter(Boolean).join("/");
    const url = new URL(`${httpProtocol}://${normalizedHost}/${route}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    return {
      host: normalizedHost,
      route,
      subPath,
      httpUrl: url.toString(),
    };
  }

  connect(): void {
    this.#started = true;
    if (untrack(() => this.#connection.socket || this.#connecting)) return;

    if (typeof this.#options.query !== "function") {
      this.queryStatus = this.#options.query ? "ready" : "idle";
      this.queryError = null;
      this.#openSocket(this.#options.query);
      return;
    }

    const generation = ++this.#connectionGeneration;
    void this.#connectResolved(generation).catch(() => {});
  }

  refreshQuery(): void {
    if (typeof this.#options.query !== "function") {
      return;
    }

    deleteCachedQuery(this.#queryCacheKey());
    this.#clearQueryRefreshTimer();
    this.#connecting = true;
    const generation = ++this.#connectionGeneration;
    void this.#resolveQuery(generation)
      .then((query) => {
        if (generation !== this.#connectionGeneration || !this.#started) {
          return;
        }
        this.#replaceSocket(query, generation);
      })
      .catch(() => {})
      .finally(() => {
        if (generation === this.#connectionGeneration) {
          this.#connecting = false;
        }
      });
  }

  async #connectResolved(generation: number): Promise<void> {
    this.#connecting = true;
    try {
      const query = await this.#resolveQuery(generation);
      if (generation !== this.#connectionGeneration || !this.#started || this.#connection.socket) {
        return;
      }
      this.#openSocket(query);
    } finally {
      if (generation === this.#connectionGeneration) {
        this.#connecting = false;
      }
    }
  }

  async #resolveQuery(generation: number): Promise<QueryObject | undefined> {
    const query = this.#options.query;
    if (!query) {
      this.queryStatus = "idle";
      this.queryError = null;
      return undefined;
    }
    if (typeof query !== "function") {
      this.queryStatus = "ready";
      this.queryError = null;
      return query;
    }

    this.queryStatus = "loading";
    this.queryError = null;
    const key = this.#queryCacheKey();
    const cached = getCachedQuery(key);
    const ttl = this.#options.cacheTtl ?? DEFAULT_QUERY_CACHE_TTL;
    let entry = cached;
    if (!entry) {
      let promise: Promise<QueryObject>;
      try {
        promise = Promise.resolve(query()).catch((error) => {
          deleteCachedQuery(key);
          throw error;
        });
      } catch (error) {
        promise = Promise.reject(error).catch((caught) => {
          deleteCachedQuery(key);
          throw caught;
        });
      }
      entry = setCachedQuery(key, promise, ttl);
    }

    try {
      const resolved = await entry.promise;
      if (generation === this.#connectionGeneration) {
        this.queryStatus = "ready";
        this.queryError = null;
        this.#scheduleQueryRefresh(key, entry);
      }
      return resolved;
    } catch (error) {
      if (generation === this.#connectionGeneration) {
        this.queryStatus = "error";
        this.queryError = error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    }
  }

  #openSocket(query: QueryObject | undefined): void {
    const options = this.#options;
    const agentNamespace = this.path[0].agent;
    const roomName = this.path[0].name;
    const prefix = options.prefix ?? "agents";
    this.#currentQuery = query;
    const { host, route, subPath, httpUrl } = this.#resolveConnectionOptions(query);
    this.#httpUrl = httpUrl;
    const baseSocketOpts = {
      host,
      id: options.id,
      path: options.path,
      protocol: options.protocol,
      protocols: options.protocols,
      query,
      onIdentityChange: () => {},
    };
    const routingOpts = options.basePath
      ? { basePath: options.basePath }
      : { party: agentNamespace, prefix, room: roomName };
    const socketOpts = subPath
      ? { ...baseSocketOpts, basePath: route }
      : { ...baseSocketOpts, ...routingOpts };
    const socket = new AgentClient<AgentT, State>({
      agent: agentNamespace,
      name: roomName,
      ...socketOpts,
    });
    socket.addEventListener("message", this.#handleMessage);
    socket.addEventListener("open", this.#handleOpen);
    socket.addEventListener("close", this.#handleClose);
    socket.addEventListener("error", this.#handleError);
    this.#connection.socket = socket;
  }

  #replaceSocket(query: QueryObject | undefined, generation: number): void {
    if (generation !== this.#connectionGeneration) {
      return;
    }
    if (this.#connection.socket) {
      this.#detachSocket(this.#connection.socket, true);
      this.#connection.socket = null;
      this.#markClosed();
    }
    this.#openSocket(query);
  }

  setState(next: State): void {
    const socket = this.#requireSocket("agent.setState()");
    socket.send(JSON.stringify({ type: MessageType.CF_AGENT_STATE, state: next }));
    this.state = next;
    this.lastStateUpdate = {
      state: next,
      source: "client",
      seq: ++this.#eventSeq,
    };
  }

  getHttpUrl(): string {
    if (!this.#httpUrl) {
      this.#httpUrl = this.#resolveConnectionOptions().httpUrl;
    }
    return this.#httpUrl;
  }

  close(): void {
    this.#started = false;
    this.#connecting = false;
    this.#connectionGeneration++;
    this.#clearQueryRefreshTimer();
    if (!this.#connection.socket) return;
    const socket = this.#connection.socket;
    this.#detachSocket(socket, true);
    this.#connection.socket = null;
    this.#markClosed();
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
          identified: true,
        } satisfies Identity;
        this.identity = newIdentity;

        this.#resolveReady();

        if (
          oldName !== null &&
          oldAgent !== null &&
          (oldName !== newName || oldAgent !== newAgent)
        ) {
          this.lastIdentityChange = {
            oldIdentity: {
              name: oldName,
              agent: oldAgent,
              identified: true,
            },
            newIdentity,
            seq: ++this.#eventSeq,
          };

          if (this.#options.onIdentityChange) {
            this.#options.onIdentityChange(oldName, newName, oldAgent, newAgent);
          } else {
            this.#warnIdentityChanged(oldName, newName, oldAgent, newAgent);
          }
        }

        this.#previousIdentity = { name: newName, agent: newAgent };
        this.#options.onIdentity?.(newName, newAgent);
        return;
      }

      case MessageType.CF_AGENT_STATE:
        this.state = msg.state as State;
        this.lastStateUpdate = {
          state: this.state as State,
          source: "server",
          seq: ++this.#eventSeq,
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
    this.#markClosed();

    if (typeof this.#options.query !== "function" || !this.#started || !this.#connection.socket) {
      return;
    }

    const socket = this.#connection.socket;
    this.#detachSocket(socket, true);
    this.#connection.socket = null;
    deleteCachedQuery(this.#queryCacheKey());
    this.#clearQueryRefreshTimer();
    const generation = ++this.#connectionGeneration;
    void this.#connectResolved(generation).catch(() => {});
  };

  #handleError = (_e: Event) => {};

  #detachSocket(socket: AgentClient<AgentT, State>, close: boolean): void {
    socket.removeEventListener("message", this.#handleMessage);
    socket.removeEventListener("open", this.#handleOpen);
    socket.removeEventListener("close", this.#handleClose);
    socket.removeEventListener("error", this.#handleError);
    if (close) {
      socket.close();
    }
  }

  #queryCacheKey(): string {
    const { host, route } = this.#resolveConnectionOptions();
    return JSON.stringify([host, route, this.#options.path ?? ""]);
  }

  #scheduleQueryRefresh(key: string, entry: QueryCacheEntry): void {
    this.#clearQueryRefreshTimer();
    if (this.#options.cacheTtl !== undefined && this.#options.cacheTtl <= 0) {
      return;
    }

    const delay = entry.expiresAt - Date.now();
    this.#queryRefreshTimer = setTimeout(
      () => {
        if (!this.#started || key !== this.#queryCacheKey()) {
          return;
        }
        this.refreshQuery();
      },
      Math.max(0, delay),
    );
  }

  #clearQueryRefreshTimer(): void {
    if (this.#queryRefreshTimer) {
      clearTimeout(this.#queryRefreshTimer);
      this.#queryRefreshTimer = null;
    }
  }

  #resetReady(): void {
    this.#readyPromise = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  #warnIdentityChanged(oldName: string, newName: string, oldAgent: string, newAgent: string): void {
    const agentChanged = oldAgent !== newAgent;
    const nameChanged = oldName !== newName;
    let changeDescription = "";
    if (agentChanged && nameChanged) {
      changeDescription = `agent "${oldAgent}" → "${newAgent}", instance "${oldName}" → "${newName}"`;
    } else if (agentChanged) {
      changeDescription = `agent "${oldAgent}" → "${newAgent}"`;
    } else {
      changeDescription = `instance "${oldName}" → "${newName}"`;
    }
    console.warn(
      `[agents-svelte] Identity changed on reconnect: ${changeDescription}. ` +
        "This can happen with server-side routing where the instance is determined by auth/session. " +
        "Use the onIdentityChange option or read lastIdentityChange if this is expected.",
    );
  }

  #requireSocket(operation: string): AgentClient<AgentT, State> {
    if (!this.#connection.socket) {
      throw new Error(`[agents-svelte] ${operation} requires a connected Agent`);
    }
    return this.#connection.socket;
  }

  #markClosed(): void {
    this.connected = false;
    this.identity = { ...this.identity, identified: false };
    this.#resetReady();

    const err = new Error("Connection closed");
    for (const p of this.#pending.values()) {
      p.reject(err);
      p.stream?.onError?.("Connection closed");
    }
    this.#pending.clear();
  }

  #call = <T>(method: string, args: unknown[] = [], options?: AgentCallOptions): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const isLegacyFormat =
        options && ("onChunk" in options || "onDone" in options || "onError" in options);
      const stream = isLegacyFormat
        ? (options as StreamOptions)
        : (options as CallOptions | undefined)?.stream;
      const timeout = isLegacyFormat ? undefined : (options as CallOptions | undefined)?.timeout;

      if (timeout) {
        timeoutId = setTimeout(() => {
          const pending = this.#pending.get(id);
          this.#pending.delete(id);
          const errorMessage = `RPC call to ${method} timed out after ${timeout}ms`;
          pending?.stream?.onError?.(errorMessage);
          reject(new Error(errorMessage));
        }, timeout);
      }

      this.#pending.set(id, {
        resolve: (value: unknown) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(value as T);
        },
        reject: (error: Error) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(error);
        },
        stream,
        timeoutId,
      });
      const req: RPCRequest = {
        type: MessageType.RPC,
        id,
        method,
        args,
      };
      try {
        this.#requireSocket("agent.call()").send(JSON.stringify(req));
      } catch (error) {
        this.#pending.delete(id);
        if (timeoutId) clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
}

export function createAgent<AgentT = unknown, State = unknown>(
  options: CreateAgentOptions,
): Agent<AgentT, State> {
  const agent = new Agent<AgentT, State>(options);

  if (typeof options.query === "function") {
    let initialized = false;
    $effect(() => {
      if (!initialized) {
        initialized = true;
        agent.connect();
        return;
      }
      agent.refreshQuery();
    });
  } else {
    onMount(() => agent.connect());
  }

  onDestroy(() => agent.close());
  return agent;
}
