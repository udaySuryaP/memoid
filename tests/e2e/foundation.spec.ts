import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
test("foundation specimen is accessible and visually deterministic", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/foundation");
  await expect(
    page.getByRole("heading", { name: "Quiet Technical Workbench foundation" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page).toHaveScreenshot("foundation.png", {
    fullPage: true,
  });
});
test("dialog traps focus, Escape closes, and focus returns", async ({ page }) => {
  await page.goto("/foundation");
  const trigger = page.getByRole("button", { name: "Open dialog" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});
