import { describe, expect, test } from "vitest";
import { render } from "svelte/server";
import SsrFactoryHarness from "./SsrFactoryHarness.svelte";

describe("SSR-safe factories", () => {
  test("construct real controllers without opening browser resources during SSR", () => {
    expect(globalThis.window).toBeUndefined();

    const result = render(SsrFactoryHarness);

    expect(result.body).toContain('data-agent-connected="false"');
    expect(result.body).toContain('data-agent="test-agent"');
    expect(result.body).toContain('data-chat-initialized="true"');
    expect(result.body).toContain('data-voice-connected="false"');
    expect(result.body).toContain('data-voice-input-listening="false"');
  });
});
