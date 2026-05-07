import { expect, test } from "@playwright/test";
import {
  collectReceivedProtocolFrames,
  collectSentProtocolFrames,
  findSentFrame,
} from "./protocol";

test("voice agent starts a WebSocket voice call with browser microphone capture", async ({
  page,
}) => {
  const sentFrames = collectSentProtocolFrames(page);
  const receivedFrames = collectReceivedProtocolFrames(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Voice Agent" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("WebSocket voice")).toBeVisible();
  await expect(page.getByText("STT Nova 3", { exact: true })).toBeVisible();
  await expect.poll(() => receivedFrames.some((frame) => frame.type === "welcome")).toBe(true);
  await expect(page.getByRole("button", { name: "Start Call" })).toBeEnabled({ timeout: 45_000 });

  await page.getByRole("button", { name: "Start Call" }).click();

  await expect(page.getByRole("button", { name: "End Call" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  await expect.poll(() => findSentFrame(sentFrames, "start_call")).toBeDefined();
  await expect.poll(() => receivedFrames.some((frame) => frame.type === "status")).toBe(true);
  await expect(page.getByRole("heading", { name: /Listening|Thinking|Speaking/ })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);

  const text = `Voice E2E text ${Date.now()}`;
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(() => sentFrames.find((frame) => frame.type === "text_message" && frame.text === text))
    .toBeDefined();

  await page.getByRole("button", { name: "End Call" }).click();
  await expect.poll(() => findSentFrame(sentFrames, "end_call")).toBeDefined();
  await expect(page.getByRole("button", { name: "Start Call" })).toBeVisible({ timeout: 45_000 });
});
