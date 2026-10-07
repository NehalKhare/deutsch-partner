import { expect, type Page } from "@playwright/test";

import { totpCode } from "../../lib/dev/totp";

/**
 * The fixture learner, for the specs that need a real account.
 *
 * Seed one with `pnpm dummy:user`, pin its password and its authenticator
 * secret, then run:
 *
 *   DEV_SEED_EMAIL=... DEV_SEED_PASSWORD=... DEV_SEED_TOTP_SECRET=... pnpm test:e2e
 *
 * Every spec that signs in skips unless all three are supplied, because the
 * account lives in a real Supabase project and CI has none.
 */
export const fixture = {
  email: process.env.DEV_SEED_EMAIL,
  password: process.env.DEV_SEED_PASSWORD,
  totpSecret: process.env.DEV_SEED_TOTP_SECRET,
};

export const FIXTURE_MISSING = !fixture.email || !fixture.password || !fixture.totpSecret;
export const FIXTURE_HINT = "set DEV_SEED_EMAIL, DEV_SEED_PASSWORD and DEV_SEED_TOTP_SECRET to run this";

/** The password, then the authenticator, then the dashboard. */
export async function signInAsFixture(page: Page): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(fixture.email as string);
  await page.getByLabel("Password").fill(fixture.password as string);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/auth\/mfa(\?|$)/);
  await page.getByLabel("Code").fill(totpCode(fixture.totpSecret as string));
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
}
