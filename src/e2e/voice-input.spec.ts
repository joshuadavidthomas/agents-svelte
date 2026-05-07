import { expect, test } from "@playwright/test";
import {
  collectReceivedProtocolFrames,
  collectSentProtocolFrames,
  findSentFrame,
} from "./protocol";

test("voice input starts real browser microphone capture", async ({ page }) => {
  const sentFrames = collectSentProtocolFrames(page);
  const receivedFrames = collectReceivedProtocolFrames(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Voice Input" })).toBeVisible();
  await expect(page.getByText("Ready")).toBeVisible();
  await expect(page.locator(".route-meta span", { hasText: "Idle" })).toBeVisible();
  await expect.poll(() => receivedFrames.some((frame) => frame.type === "welcome")).toBe(true);

  await page.getByRole("button", { name: "Dictate" }).click();

  await expect(page.getByText("Listening", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".route-meta span", { hasText: "Streaming audio" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  await expect.poll(() => findSentFrame(sentFrames, "start_call")).toBeDefined();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect(page.getByText("Muted")).toBeVisible();

  await page.getByRole("button", { name: "Unmute" }).click();
  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  await expect(page.getByText("Mic active")).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => findSentFrame(sentFrames, "end_call")).toBeDefined();
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible({ timeout: 45_000 });
});
