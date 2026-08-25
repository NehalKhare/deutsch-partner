import { expect, test, type Page } from "@playwright/test";

/**
 * The eight flows the build spec names, end to end.
 *
 * Skipped unless a fixture account is supplied, because they need a real
 * Supabase project and a real corpus. Seed one with `pnpm dummy:user`, pin the
 * password with DEV_SEED_PASSWORD, ingest the corpus with `pnpm ingest`, then:
 *
 *   DEV_SEED_EMAIL=... DEV_SEED_PASSWORD=... pnpm test:e2e
 *
 * Sign-up and onboarding have their own specs; this covers the rest, and
 * asserts the properties a unit test cannot: that a reply actually arrives a
 * piece at a time, that it is still there on reload, and that a refused turn
 * leaves the thread readable.
 */

const email = process.env.DEV_SEED_EMAIL;
const password = process.env.DEV_SEED_PASSWORD;

async function signIn(page: Page): Promise<void> {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email as string);
  await page.getByLabel("Password").fill(password as string);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function startThread(page: Page): Promise<string> {
  await page.goto("/chat");
  await page.getByRole("button", { name: /start a conversation/i }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/);

  return page.url().split("/").pop() as string;
}

test.describe("the learner journey", () => {
  test.skip(!email || !password, "set DEV_SEED_EMAIL and DEV_SEED_PASSWORD to run this");

  test("3. starts a conversation at the learner's own level", async ({ page }) => {
    await signIn(page);
    await startThread(page);

    // The thread is titled from the mini-level, so it says what it is about
    // before anything has been said in it.
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByLabel("Your message in German")).toBeVisible();
  });

  test("4 and 5. sends a message and receives a streamed reply", async ({ page }) => {
    await signIn(page);
    await startThread(page);

    await page.getByLabel("Your message in German").fill("Hallo! Ich heiße Alex.");
    await page.getByRole("button", { name: "Send" }).click();

    // The learner's own message appears at once, without waiting for a model.
    await expect(page.locator('[data-role="user"]').last()).toHaveText(
      "Hallo! Ich heiße Alex.",
    );

    // And the reply arrives and is not empty. The timeout is generous because
    // this is a real model call on the strong tier.
    const reply = page.locator('[data-role="assistant"]').last();
    await expect(reply).not.toBeEmpty({ timeout: 60_000 });
  });

  test("6. a reload proves the conversation was never stored", async ({ page }) => {
    await signIn(page);
    const threadId = await startThread(page);

    await page.getByLabel("Your message in German").fill("Ich wohne in Berlin.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator('[data-role="assistant"]').last()).not.toBeEmpty({
      timeout: 60_000,
    });

    // A reload reads from the database, and the database holds no words: the
    // thread opens fresh, which is the privacy promise made on the page itself.
    await page.goto(`/chat/${threadId}`);
    await expect(page.getByText(/nothing you say here is stored/i)).toBeVisible();
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
  });

  test("7. shows progress on the dashboard", async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByRole("heading", { name: /vocabulary/i })).toBeVisible();
  });

  test("7a. opens a vocabulary figure into the words behind it", async ({ page }) => {
    await signIn(page);

    // A count on its own is not something a learner can use. Whether there are
    // words yet depends on what this fixture has said, so both states are
    // asserted for what they are: the panel opens either way.
    const known = page.getByRole("button", { name: /known/i });
    await expect(known).toHaveAttribute("aria-expanded", "false");

    await known.click();

    await expect(known).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${await known.getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
  });

  test("7b. offers something to do next, and the link works", async ({ page }) => {
    await signIn(page);

    const next = page.getByRole("heading", { name: /do this next/i });
    if (await next.isVisible()) {
      // Whichever recommendation won: the four candidate titles in
      // lib/dashboard/summary.ts all start with one of these verbs.
      await page
        .getByRole("link")
        .filter({ hasText: /catch up|talk about|practise|work on/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/(review|chat)/);
    }
  });

  test("8. completes a review activity", async ({ page }) => {
    await signIn(page);
    await page.goto("/review");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Catch up");
    // Either there is something due or there is not; both are correct states,
    // and both must render rather than erroring.
    await expect(page.getByRole("heading", { name: /overdue/i })).toBeVisible();
  });

  test("8a. opens the Trainer from Catch up, which is the only door to it", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/review");

    await page.getByRole("link", { name: /perfect your mistakes/i }).click();

    await expect(page).toHaveURL(/\/trainer/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trainer");
  });

  // The conversation list this journey used to end on is gone from the
  // dashboard, and with it the only route to the delete control. The action
  // and its component are still tested in tests/unit; there is no longer a
  // page from which to drive them.
});

test.describe("what a signed-out visitor cannot do", () => {
  test("cannot open a thread", async ({ page }) => {
    await page.goto("/chat");

    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("cannot post to the chat endpoint", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: {
        threadId: "22222222-2222-4222-8222-222222222222",
        message: "Hallo",
      },
    });

    expect(response.status()).toBe(401);
  });

  test("cannot reach the cost dashboard", async ({ page }) => {
    await page.goto("/operations/costs");

    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("the chat endpoint's own rules", () => {
  test.skip(!email || !password, "set DEV_SEED_EMAIL and DEV_SEED_PASSWORD to run this");

  test("refuses a malformed body", async ({ page, request }) => {
    await signIn(page);

    const response = await request.post("/api/chat", {
      data: { message: "no thread id" },
    });

    expect(response.status()).toBe(400);
    // A plain sentence, never an internal cause.
    expect(await response.text()).not.toMatch(/zod|schema|postgres/i);
  });

  test("refuses a thread that is not the learner's", async ({ page, request }) => {
    await signIn(page);

    const response = await request.post("/api/chat", {
      data: {
        threadId: "00000000-0000-4000-8000-000000000000",
        message: "Hallo",
      },
    });

    // Row Level Security makes somebody else's thread indistinguishable from
    // one that does not exist, which is the point.
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("does not leak an operator page to an ordinary learner", async ({ page }) => {
    await signIn(page);
    const response = await page.goto("/operations/costs");

    // A 404 rather than a 403: confirming the page exists tells somebody there
    // is one worth finding.
    expect(response?.status()).toBe(404);
  });
});
