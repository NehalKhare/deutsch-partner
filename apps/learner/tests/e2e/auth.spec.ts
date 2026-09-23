import { expect, test } from "@playwright/test";

/**
 * Proves the request guard is actually wired. The unit tests exercise
 * updateSession directly; only a real request through the built app confirms
 * Next.js picked up proxy.ts under its new name.
 */

test("a signed-out visitor asking for the dashboard lands on sign-in", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Welcome back",
  );
});

test("the sign-in page remembers where the visitor was heading", async ({
  page,
}) => {
  await page.goto("/dashboard/progress");

  await expect(page).toHaveURL(/next=%2Fdashboard%2Fprogress/);
});

test("the sign-in page is reachable directly", async ({ page }) => {
  await page.goto("/auth/login");

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("a visitor can cross to the sign-up form", async ({ page }) => {
  await page.goto("/auth/login");
  await page.getByRole("link", { name: /create an account/i }).click();

  await expect(page).toHaveURL(/\/auth\/sign-up/);
  await expect(page.getByLabel("Confirm password")).toBeVisible();
});

test("static assets are not intercepted by the guard", async ({ request }) => {
  const response = await request.get("/next.svg");

  expect(response.status()).toBe(200);
});

test("onboarding requires a session like any other protected page", async ({
  page,
}) => {
  await page.goto("/onboarding");

  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page).toHaveURL(/next=%2Fonboarding/);
});
