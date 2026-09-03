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

test.describe("Stage 10D Project surfaces", () => {
  test.skip(process.env.STAGE10D_E2E !== "1", "requires the isolated Stage 10D browser database");

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: "__Host-memoid_session",
        value: "stage10d-e2e-session-credential-000001",
        domain: "127.0.0.1",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("inventory, create, shell, and settings remain accessible and connected", async ({
    page,
  }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browser proof project/ })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("link", { name: "New project" }).click();
    await expect(page.getByRole("heading", { name: "Create a project" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const uniqueName = `Browser created ${test.info().project.name}`;
    await page.getByLabel("Project name").fill(uniqueName);
    await page.getByLabel("Description").fill("Created through the real lifecycle command.");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("link", { name: "Project settings" }).click();
    await expect(page.getByRole("heading", { name: "Project details" })).toBeVisible();
    await page.getByLabel("Description").fill("Updated through optimistic concurrency.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Updated through optimistic concurrency.")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
