import { expect, test } from "@playwright/test";

/**
 * Signs in as the fixture learner and lands on the dashboard.
 *
 * Skipped unless the credentials are supplied, because the account lives in a
 * real Supabase project and CI has none. Seed it with `pnpm dummy:user`, pin
 * the password with DEV_SEED_PASSWORD, then run:
 *
 *   DEV_SEED_EMAIL=... DEV_SEED_PASSWORD=... pnpm test:e2e
 *
 * The other auth specs prove a signed-out visitor is turned away. This is the
 * other half: that a real account gets all the way through the guard, the
 * onboarding gate and an RLS-scoped read.
 */

const email = process.env.DEV_SEED_EMAIL;
const password = process.env.DEV_SEED_PASSWORD;

test.describe("the fixture learner", () => {
  test.skip(
    !email || !password,
    "set DEV_SEED_EMAIL and DEV_SEED_PASSWORD to run this",
  );

  test("signs in and reaches the dashboard", async ({ page }) => {
    await page.goto("/auth/login");

    await page.getByLabel("Email").fill(email as string);
    await page.getByLabel("Password").fill(password as string);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Your progress",
    );
  });

  test("is not asked to onboard a second time", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(email as string);
    await page.getByLabel("Password").fill(password as string);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
