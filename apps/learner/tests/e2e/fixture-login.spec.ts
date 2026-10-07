import { expect, test } from "@playwright/test";

import { FIXTURE_HINT, FIXTURE_MISSING, fixture, signInAsFixture } from "./fixture";

/**
 * Signs in as the fixture learner — password, then authenticator — and lands
 * on the dashboard.
 *
 * Skipped unless the credentials are supplied, because the account lives in a
 * real Supabase project and CI has none. See ./fixture.ts for how to seed it.
 *
 * The other auth specs prove a signed-out visitor is turned away. This is the
 * other half: that a real account gets all the way through the guard, the
 * second factor, the onboarding gate and an RLS-scoped read.
 */

test.describe("the fixture learner", () => {
  test.skip(FIXTURE_MISSING, FIXTURE_HINT);

  test("signs in with both factors and reaches the dashboard", async ({ page }) => {
    await signInAsFixture(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your progress");
  });

  test("gets no further than the authenticator on a password alone", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(fixture.email as string);
    await page.getByLabel("Password").fill(fixture.password as string);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/mfa/);

    // The proxy sends a half-signed-in session back; and so does the page.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/mfa/);

    // A fetch is not redirected: the route handler refuses the session itself.
    const response = await page.request.get("/api/scenarios/search?q=hallo", { maxRedirects: 0 });
    expect([401, 403]).toContain(response.status());
  });

  test("is not asked to onboard a second time", async ({ page }) => {
    await signInAsFixture(page);

    await page.goto("/onboarding");

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
