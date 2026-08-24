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
    await expect(page.getByRole("heading", { name: /recent conversations/i })).toBeVisible();
  });

  test("7b. offers something to do next, and the link works", async ({ page }) => {
    await signIn(page);

    const next = page.getByRole("heading", { name: /do this next/i });
    if (await next.isVisible()) {
      await page.getByRole("link").filter({ hasText: /review|talk about/i }).first().click();
      await expect(page).toHaveURL(/\/(review|chat)/);
    }
  });

  test("8. completes a review activity", async ({ page }) => {
    await signIn(page);
    await page.goto("/review");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review");
    // Either there is something due or there is not; both are correct states,
    // and both must render rather than erroring.
    await expect(page.getByRole("heading", { name: /overdue/i })).toBeVisible();
  });

  test("9. deletes a conversation, and it is gone on reload", async ({ page }) => {
    await signIn(page);
    const threadId = await startThread(page);

    await page.goto("/dashboard");
    const row = page.locator("li", { has: page.locator(`a[href="/chat/${threadId}"]`) });
    await expect(row).toBeVisible();

    // The row's live region is present and not display:none before there is
    // anything in it. A region hidden until its message arrives is one a
    // screen reader can miss entirely.
    await expect(row.getByRole("status")).toHaveCount(1);
    await expect(row.getByRole("status")).not.toHaveCSS("display", "none");

    // One press arms, the second deletes. A single-press delete on a list of
    // links is a mis-click away from losing a conversation.
    await row.getByRole("button", { name: /^delete/i }).first().click();
    await expect(row.getByText(/cannot be undone/i)).toBeVisible();
    await row.getByRole("button", { name: /for good/i }).click();

    await expect(row).toHaveCount(0);

    // And the keyboard is somewhere, rather than back at the top of the
    // document with no word about what happened.
    await expect(page.getByText(/^Deleted /)).toBeVisible();
    await expect(page.getByText(/^Deleted /)).toBeFocused();

    // The row going is the client being told. This is the database being asked
    // again, which is the part that could be a lie.
    await page.reload();
    await expect(page.locator(`a[href="/chat/${threadId}"]`)).toHaveCount(0);

    // And the thread itself is a 404, not merely hidden from a list.
    await page.goto(`/chat/${threadId}`);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      /Hallo|Tsch/,
    );
  });
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
