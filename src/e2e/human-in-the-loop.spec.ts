import { expect, test } from "@playwright/test";
import { collectSentProtocolFrames, findSentFrame } from "./protocol";

test("human-in-the-loop approval flow approves a server tool call", async ({ page }) => {
  const sentFrames = collectSentProtocolFrames(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Human in the Loop" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 45_000 });

  const clearButton = page.getByRole("button", { name: "Clear" });
  if (await clearButton.isEnabled()) {
    await clearButton.click();
    await expect(
      page.getByRole("heading", { name: "Try a tool that needs approval" }),
    ).toBeVisible();
  }

  const prompt = "What's the weather in Austin? Use the weather tool.";
  await page.getByLabel("Message").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator("article.user").last()).toContainText(prompt);
  await expect(page.locator("span", { hasText: "Waiting for approval" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator(".tool-card.approval")).toContainText("getWeather", {
    timeout: 90_000,
  });

  await page.getByRole("button", { name: "Approve" }).click();

  await expect
    .poll(() => findSentFrame(sentFrames, "cf_agent_tool_approval"))
    .toEqual(
      expect.objectContaining({
        type: "cf_agent_tool_approval",
        approved: true,
        autoContinue: true,
      }),
    );

  await expect(page.locator(".tool-card").filter({ hasText: "getWeather" }).last()).toContainText(
    /Approved|Done/,
    { timeout: 90_000 },
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});
