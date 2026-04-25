import { describe, expect, it } from "vitest";
import { camelCaseToKebabCase } from "../utils.ts";

describe("camelCaseToKebabCase", () => {
  it.each([
    ["ChatAgent", "chat-agent"],
    ["chatAgent", "chat-agent"],
    ["MY_AGENT", "my-agent"],
    ["My_Agent", "my--agent"],
    ["TestStateAgent", "test-state-agent"],
    ["Already-Kebab", "already--kebab"]
  ])("converts %s to %s", (input, expected) => {
    expect(camelCaseToKebabCase(input)).toBe(expected);
  });
});
