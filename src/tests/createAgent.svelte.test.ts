import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { Agent, type CreateAgentOptions } from "../agent.svelte.ts";
import { getTestWorkerHost } from "./test-config.ts";

type IdentifiedAgentLike = {
  identity: {
    identified: boolean;
  };
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()?.();
    } catch {
      // ignore
    }
  }
});

async function waitForIdentified(agent: IdentifiedAgentLike, timeout = 10000) {
  await vi.waitFor(
    () => {
      expect(agent.identity.identified).toBe(true);
    },
    { timeout },
  );
}

function makeAgent<State = unknown>(options: CreateAgentOptions): Agent<unknown, State> {
  const agent = new Agent<unknown, State>(options);
  agent.connect();
  cleanups.push(() => agent.close());
  return agent;
}

describe("createAgent", () => {
  describe("connection lifecycle", () => {
    it("should connect and receive identity", async () => {
      const { host, protocol } = getTestWorkerHost();
      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-identity",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      expect(agent.identity.identified).toBe(true);
      expect(agent.identity.name).toBe("svelte-test-identity");
      expect(agent.identity.agent).toBe("test-state-agent");
    });

    it("should populate identity on connect", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-on-identity",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      expect(agent.identity.name).toBe("svelte-test-on-identity");
      expect(agent.identity.agent).toBe("test-state-agent");
    });

    it("should expose readiness through identity.identified", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-ready",
        host,
        protocol,
      });

      await waitForIdentified(agent);
      expect(agent.identity.identified).toBe(true);
    });

    it("should populate mcp from the initial protocol messages", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-mcp-initial",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.mcp).not.toBeNull();
        },
        { timeout: 10000 },
      );
    });
  });

  describe("state synchronization", () => {
    it("should record client state updates with source metadata", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-state-client",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      const newState = {
        count: 123,
        items: ["svelte-test"],
        lastUpdated: Date.now(),
      };
      agent.setState(newState);

      expect(agent.lastStateUpdate?.state).toEqual(newState);
      expect(agent.lastStateUpdate?.source).toBe("client");
    });

    it("should record server-sourced state updates with source metadata", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number | null;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-server",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.lastStateUpdate?.source).toBe("server");
          expect(agent.lastStateUpdate?.state).toEqual({
            count: 0,
            items: [],
            lastUpdated: null,
          });
        },
        { timeout: 10000 },
      );
    });

    it("should receive initial state from server on connect", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-initial",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.state).not.toBeUndefined();
          expect(agent.state?.count).toBe(0);
          expect(agent.state?.items).toEqual([]);
        },
        { timeout: 10000 },
      );
    });

    it("should update state property on client setState", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-prop-client",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.identity.identified).toBe(true);
          expect(agent.state).not.toBeUndefined();
        },
        { timeout: 10000 },
      );

      const newState = { count: 42, items: ["test"], lastUpdated: 1000 };
      agent.setState(newState);
      flushSync();

      expect(agent.state?.count).toBe(42);
      expect(agent.state?.items).toEqual(["test"]);
    });

    it("should update state property on server broadcast", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-prop-server",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.identity.identified).toBe(true);
          expect(agent.state).not.toBeUndefined();
        },
        { timeout: 10000 },
      );

      const newState = {
        count: 999,
        items: ["server-state"],
        lastUpdated: 2000,
      };
      agent.setState(newState);

      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(999);
        },
        { timeout: 5000 },
      );
    });

    it("should populate stateError when the server rejects a readonly update", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{ count: number }>({
        agent: "TestReadonlyAgent",
        name: "svelte-test-readonly-error",
        host,
        protocol,
        query: { readonly: "true" },
      });

      await waitForIdentified(agent);
      agent.setState({ count: 1 });

      await vi.waitFor(
        () => {
          expect(agent.stateError).toBeTruthy();
        },
        { timeout: 5000 },
      );
    });

    it("should track multiple sequential state updates", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-sequential",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.identity.identified).toBe(true);
          expect(agent.state).not.toBeUndefined();
        },
        { timeout: 10000 },
      );

      agent.setState({ count: 1, items: ["first"], lastUpdated: 1 });
      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(1);
        },
        { timeout: 5000 },
      );

      agent.setState({ count: 2, items: ["second"], lastUpdated: 2 });
      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(2);
          expect(agent.state?.items).toEqual(["second"]);
        },
        { timeout: 5000 },
      );
    });

    it("should allow spreading agent.state for partial updates", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-spread",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.identity.identified).toBe(true);
          expect(agent.state).not.toBeUndefined();
        },
        { timeout: 10000 },
      );

      agent.setState({ count: 10, items: ["a", "b"], lastUpdated: 100 });

      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(10);
          expect(agent.state?.items).toEqual(["a", "b"]);
        },
        { timeout: 5000 },
      );

      agent.setState({ ...agent.state!, count: 20 });

      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(20);
          expect(agent.state?.items).toEqual(["a", "b"]);
          expect(agent.state?.lastUpdated).toBe(100);
        },
        { timeout: 5000 },
      );
    });

    it("should update state property and lastStateUpdate together", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent<{
        count: number;
        items: string[];
        lastUpdated: number;
      }>({
        agent: "TestStateAgent",
        name: "svelte-test-state-both",
        host,
        protocol,
      });

      await vi.waitFor(
        () => {
          expect(agent.identity.identified).toBe(true);
          expect(agent.state).not.toBeUndefined();
        },
        { timeout: 10000 },
      );

      const newState = { count: 77, items: ["both"], lastUpdated: 7 };
      agent.setState(newState);

      expect(agent.lastStateUpdate?.state).toEqual(newState);
      expect(agent.lastStateUpdate?.source).toBe("client");

      await vi.waitFor(
        () => {
          expect(agent.state?.count).toBe(77);
        },
        { timeout: 5000 },
      );
    });
  });

  describe("RPC calls", () => {
    it("should call methods via call()", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestCallableAgent",
        name: "svelte-test-rpc-call",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      const result = await agent.call<number>("add", [10, 20]);
      expect(result).toBe(30);
    });

    it("should call methods via stub proxy", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestCallableAgent",
        name: "svelte-test-rpc-stub",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      const result = await (
        agent.stub as {
          add: (a: number, b: number) => Promise<number>;
        }
      ).add(5, 7);
      expect(result).toBe(12);
    });

    it("should handle RPC errors", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestCallableAgent",
        name: "svelte-test-rpc-error",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      await expect(agent.call("throwError", ["test error"])).rejects.toThrow();
    });

    it("should support streaming RPC", async () => {
      const { host, protocol } = getTestWorkerHost();
      const chunks: unknown[] = [];
      const onChunk = vi.fn((chunk) => chunks.push(chunk));
      const onDone = vi.fn();

      const agent = makeAgent({
        agent: "TestCallableAgent",
        name: "svelte-test-rpc-stream",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      const result = await agent.call<number>("streamNumbers", [5], {
        onChunk,
        onDone,
      });

      expect(onChunk.mock.calls.length).toBeGreaterThan(0);
      expect(onDone).toHaveBeenCalled();
      expect(result).toBe(5);
    });
  });

  describe("query parameters", () => {
    it("includes non-null query params in the HTTP URL", () => {
      const agent = new Agent({
        agent: "TestStateAgent",
        name: "svelte-test-query-url",
        host: "localhost:8787",
        protocol: "ws",
        query: { token: "abc", skip: null },
      });

      expect(agent.getHttpUrl()).toBe(
        "http://localhost:8787/agents/test-state-agent/svelte-test-query-url?token=abc",
      );
    });

    it("should pass static query params", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: "svelte-test-query",
        host,
        protocol,
        query: { foo: "bar", baz: "qux" },
      });

      await waitForIdentified(agent);

      expect(agent.identity.identified).toBe(true);
    });
  });

  describe("basePath routing", () => {
    it("should connect and receive identity via basePath", async () => {
      const { host, protocol } = getTestWorkerHost();
      const instanceName = `svelte-basepath-${Date.now()}`;

      const agent = makeAgent({
        agent: "TestStateAgent",
        name: instanceName,
        host,
        protocol,
        basePath: `custom-state/${instanceName}`,
      });

      await waitForIdentified(agent);

      expect(agent.identity.identified).toBe(true);
      expect(agent.identity.name).toBe(instanceName);
      expect(agent.identity.agent).toBe("test-state-agent");
    });

    it("should connect via server-determined basePath routing", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestStateAgent",
        host,
        protocol,
        basePath: "user",
      });

      await waitForIdentified(agent);

      expect(agent.identity.identified).toBe(true);
      expect(agent.identity.name).toBe("auth-user");
      expect(agent.identity.agent).toBe("test-state-agent");
    });
  });

  describe("stub proxy behavior", () => {
    it("should not trigger RPC for internal methods like toJSON", async () => {
      const { host, protocol } = getTestWorkerHost();

      const agent = makeAgent({
        agent: "TestCallableAgent",
        name: "svelte-test-stub-internal",
        host,
        protocol,
      });

      await waitForIdentified(agent);

      const stub = agent.stub as unknown as Record<string, unknown>;
      expect(stub.toJSON).toBeUndefined();
      expect(stub.then).toBeUndefined();
      expect(stub.valueOf).toBeUndefined();

      const stringified = JSON.stringify({ stub: agent.stub });
      expect(stringified).toBe('{"stub":{}}');
    });
  });
});
