import { expect, test } from "@playwright/test";

/**
 * Phase 0 smoke test: the production build boots and serves the app shell.
 * Real user journeys arrive in Phase 20.
 */
test("the application serves its home page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the companion changes mood when a visitor tries a turn", async ({ page }) => {
  await page.goto("/");

  const companion = page.getByRole("img").first();
  await expect(companion).toHaveAttribute("data-emotion", "smiling");

  await page.getByText("You slip up", { exact: true }).click();
  await expect(companion).toHaveAttribute("data-emotion", "sad");
});

test("the landing page routes a new visitor to sign-up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start free" }).first().click();

  await expect(page).toHaveURL(/\/auth\/sign-up/);
});

test("the companion speaks while it is the one talking", async ({ page }) => {
  // The landing demo is the only place in the product that reaches every
  // companion state without a model call, which makes it the only place the
  // animation itself can be asserted rather than the attribute that drives it.
  await page.goto("/");

  const root = page.locator("[data-animated]").first();
  await expect(root).toHaveAttribute("data-animated", "true");

  const blob = root.locator("> div");
  await expect(blob).not.toHaveCSS("animation-name", "none");

  const mouth = root.locator("[data-part='mouth']");
  await expect(mouth).not.toHaveCSS("animation-name", "none");
});

test("the companion holds still and listens when it is the learner's turn", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("You speak", { exact: true }).click();

  const root = page.locator("[data-animated]").first();
  await expect(root).toHaveAttribute("data-emotion", "listening");
  await expect(root).toHaveAttribute("data-animated", "false");

  // Listening is a pose, not a loop: a character that fidgets while you are
  // trying to speak is one you stop speaking to.
  await expect(root.locator("[data-part='mouth']")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("the companion holds still when motion is reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const body = page.locator("[data-animated='true'] > div").first();
  await expect(body).toHaveCSS("animation-name", "none");
});
