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

test("account access is responsive, accessible, and explains the provider boundary", async ({
  page,
}) => {
  await page.goto("/auth/access");
  await expect(page.getByRole("heading", { name: "Continue securely to Memoid" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with AuthKit" })).toHaveAttribute(
    "href",
    /\/auth\/login/,
  );
  await expect(page.getByText(/never asks for your passkey/i)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("protected errors do not disclose resource existence", async ({ page }) => {
  await page.goto("/protected-error");
  await expect(page.getByRole("heading", { name: "That location isn’t available" })).toBeVisible();
  await expect(
    page.getByText(/may not exist, or your current Account may not have access/i),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
