import { describe, expect, it } from "vitest";
import { AgentToolEvents } from "../tool-events.svelte.ts";
import { createMockAgent } from "./mock-agent.ts";

function frame(
  sequence: number,
  event: Record<string, unknown>,
  parentToolCallId: string | null = "tool-1",
) {
  return {
    type: "agent-tool-event",
    ...(parentToolCallId !== null ? { parentToolCallId } : {}),
    sequence,
    event,
  };
}

describe("AgentToolEvents", () => {
  it("groups agent tool runs by parent tool call", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();

    mock.dispatchServerMessage(
      frame(0, {
        kind: "started",
        runId: "research-1",
        agentType: "Researcher",
        inputPreview: "find sources",
        order: 0,
      }),
    );

    expect(events.getRunsForToolCall("tool-1").map((run) => run.runId)).toEqual(["research-1"]);
    expect(events.runsById["research-1"]).toMatchObject({
      agentType: "Researcher",
      inputPreview: "find sources",
      status: "running",
      subAgent: { agent: "Researcher", name: "research-1" },
    });
  });

  it("accumulates streamed chunks into run parts", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();

    mock.dispatchServerMessage(
      frame(0, {
        kind: "started",
        runId: "research-2",
        agentType: "Researcher",
        order: 0,
      }),
    );
    mock.dispatchServerMessage(
      frame(1, {
        kind: "chunk",
        runId: "research-2",
        body: JSON.stringify({ type: "text-delta", delta: "hello" }),
      }),
    );
    mock.dispatchServerMessage(
      frame(2, {
        kind: "finished",
        runId: "research-2",
        summary: "done",
      }),
    );

    expect(events.runsById["research-2"].parts[0]).toMatchObject({
      type: "text",
      text: "hello",
    });
    expect(events.runsById["research-2"]).toMatchObject({
      status: "completed",
      summary: "done",
    });
  });

  it("dedupes replayed frames by parent, run id, and sequence", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();

    const started = frame(0, {
      kind: "started",
      runId: "research-3",
      agentType: "Researcher",
      order: 0,
    });
    const chunk = frame(1, {
      kind: "chunk",
      runId: "research-3",
      body: JSON.stringify({ type: "text-delta", delta: "hello" }),
    });

    mock.dispatchServerMessage(started);
    mock.dispatchServerMessage(chunk);
    mock.dispatchServerMessage({ ...chunk, replay: true });

    expect(events.runsById["research-3"].parts[0]).toMatchObject({ text: "hello" });
  });

  it("tracks unbound runs separately", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();

    mock.dispatchServerMessage(
      frame(
        0,
        {
          kind: "started",
          runId: "planner-1",
          agentType: "Planner",
          order: 0,
        },
        null,
      ),
    );

    expect(events.unboundRuns.map((run) => run.runId)).toEqual(["planner-1"]);
    expect(events.runsByToolCallId).toEqual({});
  });

  it("resetLocalState clears runs and the dedupe set", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();

    const started = frame(0, {
      kind: "started",
      runId: "research-4",
      agentType: "Researcher",
      order: 0,
    });

    mock.dispatchServerMessage(started);
    events.resetLocalState();
    mock.dispatchServerMessage(started);

    expect(Object.keys(events.runsById)).toEqual(["research-4"]);
  });

  it("detaches listeners on close", () => {
    const mock = createMockAgent();
    const events = new AgentToolEvents({ agent: mock.agent });
    events.connect();
    events.close();

    mock.dispatchServerMessage(
      frame(0, {
        kind: "started",
        runId: "research-5",
        agentType: "Researcher",
        order: 0,
      }),
    );

    expect(events.runsById).toEqual({});
  });
});
