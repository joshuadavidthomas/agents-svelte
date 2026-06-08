import { expect, type Locator, type Page, test } from "@playwright/test";
import { collectSentProtocolFrames, findSentFrame, parseFrameRequestBody } from "./protocol";

async function openCleanToolChat(page: Page): Promise<void> {
  const initialMessagesLoaded = page.waitForResponse(
    (response) => response.request().method() === "GET" && response.url().includes("/get-messages"),
    { timeout: 45_000 },
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dynamic Tools", exact: true })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("4 of 4 tools active")).toBeVisible();
  expect((await initialMessagesLoaded).ok()).toBe(true);

  const clearButton = page.getByRole("button", { name: "Clear" });
  const emptyState = page.getByRole("heading", { name: "Dynamic tools are ready" });
  const chatState = await waitForCleanChatState(page, clearButton, emptyState);

  if (chatState === "clearable") {
    await clearButton.click();
  }
  await expect(emptyState).toBeVisible();
}

async function waitForCleanChatState(
  page: Page,
  clearButton: Locator,
  emptyState: Locator,
): Promise<"clearable" | "empty"> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await clearButton.isEnabled()) return "clearable";
    if (await emptyState.isVisible()) return "empty";
    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for the tool chat to become clearable or empty.");
}

async function triggerPageTitleTool(page: Page, prompt: string): Promise<void> {
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator("article.user").last()).toContainText(prompt);
  await expect(page.getByText("getPageTitle").last()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".tool-card")).toContainText("Done", { timeout: 90_000 });
  await expect(page.locator(".tool-card")).toContainText("Dynamic Tools", { timeout: 90_000 });
  await expect(page.getByText("Error")).toHaveCount(0);
}

test("tool calls advertise client tools and render browser tool output", async ({ page }) => {
  const sentFrames = collectSentProtocolFrames(page);

  await openCleanToolChat(page);
  await triggerPageTitleTool(page, "Use the getPageTitle browser tool and tell me the page title.");

  const chatRequest = findSentFrame(sentFrames, "cf_agent_use_chat_request");
  expect(chatRequest).toBeDefined();
  const body = parseFrameRequestBody(chatRequest);
  expect(body.clientTools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "getPageTitle",
        parameters: expect.objectContaining({ type: "object" }),
      }),
    ]),
  );

  await expect
    .poll(() => findSentFrame(sentFrames, "cf_agent_tool_result"))
    .toEqual(
      expect.objectContaining({
        type: "cf_agent_tool_result",
        toolName: "getPageTitle",
        output: expect.objectContaining({ title: "Dynamic Tools" }),
        clientTools: expect.arrayContaining([expect.objectContaining({ name: "getPageTitle" })]),
      }),
    );
});

test("tool call output is restored after reload", async ({ page }) => {
  const prompt = `Use the getPageTitle browser tool for reload persistence ${Date.now()}.`;

  await openCleanToolChat(page);
  await triggerPageTitleTool(page, prompt);

  await page.reload();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("article.user").last()).toContainText(prompt, { timeout: 45_000 });
  await expect(page.locator(".tool-card").last()).toContainText("getPageTitle", {
    timeout: 45_000,
  });
  await expect(page.locator(".tool-card").last()).toContainText("Dynamic Tools", {
    timeout: 45_000,
  });
});
