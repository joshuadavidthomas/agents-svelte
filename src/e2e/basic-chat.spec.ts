import { expect, type Page, test } from "@playwright/test";

async function openCleanChat(page: Page): Promise<void> {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "AI Chat" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });

  const newButton = page.getByRole("button", { name: "New" });
  if (await newButton.isEnabled()) {
    await newButton.click();
    await expect(page.getByRole("heading", { name: "Start a conversation" })).toBeVisible();
  }
}

async function sendMessageAndWaitForAssistant(page: Page, text: string): Promise<void> {
  const message = page.getByLabel("Message");
  await message.fill(text);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator("article.user").last()).toContainText(text);
  await expect(page.locator("article.message:not(.user)").last()).toContainText(/\S/, {
    timeout: 90_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("basic chat connects and streams an assistant response", async ({ page }) => {
  await openCleanChat(page);
  await sendMessageAndWaitForAssistant(page, "Reply with one short sentence about Svelte.");
});

test("basic chat restores persisted messages after reload", async ({ page }) => {
  const prompt = `Persistence check ${Date.now()}`;

  await openCleanChat(page);
  await sendMessageAndWaitForAssistant(page, prompt);

  const historyRequest = page.waitForRequest(
    (request) => request.url().includes("/get-messages") && request.method() === "GET",
  );
  await page.reload();
  const request = await historyRequest;

  expect(request.url()).toContain("/agents/chat-agent/basic-chat/get-messages");
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("article.user").last()).toContainText(prompt, { timeout: 45_000 });
  await expect(page.locator("article.message:not(.user)").last()).toContainText(/\S/, {
    timeout: 45_000,
  });
});
