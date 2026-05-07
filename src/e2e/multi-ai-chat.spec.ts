import { expect, test } from "@playwright/test";

test("multi AI chat exercises Agent state sync and typed RPC", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Multi AI Chat" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });

  await page.getByPlaceholder("Facts to remember across chats…").fill("Prefers concise answers.");
  await page.getByRole("button", { name: "Save memory" }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 45_000 });

  await page.getByRole("button", { name: "New" }).click();
  await expect(page.locator(".chat-item").first()).toContainText("No messages yet", {
    timeout: 45_000,
  });
  await expect(page.getByText("Send the first message to start this chat")).toBeVisible({
    timeout: 45_000,
  });

  await page.locator(".chat-actions").first().getByRole("button", { name: "Rename" }).click();
  await page.getByLabel(/New title for/).fill("E2E renamed chat");
  await page.locator(".inline-edit").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".chat-item").first()).toContainText("E2E renamed chat", {
    timeout: 45_000,
  });

  await page.locator(".chat-actions").first().getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("group", { name: "Delete E2E renamed chat?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.locator(".chat-item").filter({ hasText: "E2E renamed chat" })).toHaveCount(0, {
    timeout: 45_000,
  });
});
