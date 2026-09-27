import { expect, test } from "@playwright/test";

/**
 * What a crawler gets from the built app. The unit tests hold the policy;
 * only a real request confirms Next.js serves each file under its name, that
 * the proxy leaves them alone, and that the head of the landing page carries
 * what the metadata says it does. The web server runs with SEO_INDEXING on,
 * so this is the production shape.
 */

test("robots.txt allows the public pages, keeps crawlers out of the rooms, and names the sitemap", async ({ request, baseURL }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toMatch(/^User-Agent: \*$/m);
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).toMatch(/^Disallow: \/dashboard/m);
  expect(body).toMatch(/^Disallow: \/api/m);
  expect(body).toMatch(/^User-Agent: GPTBot$/m);
  expect(body).toMatch(/^User-Agent: ClaudeBot$/m);
  expect(body).toMatch(/^Content-Signal: search=yes, ai-input=yes$/m);
  expect(body).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
});

test("sitemap.xml lists the public pages and nothing behind sign-in", async ({ request, baseURL }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const body = await response.text();
  expect(body).toContain(`<loc>${baseURL}/</loc>`);
  expect(body).toContain(`<loc>${baseURL}/auth/sign-up</loc>`);
  expect(body).toContain(`<loc>${baseURL}/pricing</loc>`);
  expect(body).not.toContain("/dashboard");
  expect(body).not.toContain("/billing");
  expect(body).not.toContain("/chat");
});

test("llms.txt describes the product in plain text", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const body = await response.text();
  expect(body.startsWith("# Deutsch Partner")).toBe(true);
  expect(body).toContain("## Questions");
});

test("the manifest and the generated images are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toMatchObject({ name: "Deutsch Partner", start_url: "/" });

  for (const path of ["/opengraph-image", "/icon", "/apple-icon"]) {
    const image = await request.get(path);
    expect(image.status(), path).toBe(200);
    expect(image.headers()["content-type"], path).toBe("image/png");
  }
});

test("the landing page's head says what the metadata says", async ({ page, baseURL }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Deutsch Partner — Talk German from day one");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const structured = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(structured ?? "")["@graph"]).toEqual(
    expect.arrayContaining([expect.objectContaining({ "@type": "FAQPage" })]),
  );
});

test("a page title picks up the site's name from the template", async ({ page }) => {
  await page.goto("/auth/sign-up");

  await expect(page).toHaveTitle("Create an account — Deutsch Partner");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/auth\/sign-up$/);
});

test("a private room tells a crawler to leave before the redirect", async ({ request }) => {
  const response = await request.get("/dashboard", { maxRedirects: 0 });
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const handler = await request.get("/api/health");
  expect(handler.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});
