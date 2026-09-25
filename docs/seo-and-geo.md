# Search and answer engines

How the learner product is found — by a search engine, and by the answer
engines that quote a site instead of listing it. The operator app is the
opposite case and is covered at the end.

The whole surface is three public pages: the landing page, sign-up and
sign-in. Everything else is a learner's own room and is kept out of every
index three ways. There is no blog and no content section; what an engine can
read about the product is the landing page, its structured data, and
`/llms.txt`.

## The one switch

| Variable | Where | Effect |
| --- | --- | --- |
| `SEO_INDEXING` | learner app only | `true`: robots.txt allows the public pages and names the sitemap; every public page carries `index, follow`. Anything else, including unset: robots.txt disallows everything for everyone, the sitemap is empty, and every page carries `noindex, nofollow` |
| `APP_URL` | learner app | The origin every absolute URL is built from: the canonical, the share card, the sitemap, the links in `llms.txt`. Never the request's `Host` header, which a client can set |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | learner app, optional | Site-ownership tokens for the two consoles. Printed into the page head when set; no tag when not. Public by design, not secrets |

Off unless stated, on purpose. Staging deploys on every green `main` to an
origin anybody can reach, and a staging copy that gets indexed competes with
production for the product's own name. `deploy-apps.yml` sets it to `true`
for the `production` environment and `false` for everything else; the Cloud
Run manifest passes it through.

## What is served

| Path | File | What it is |
| --- | --- | --- |
| `/robots.txt` | `app/robots.ts` | The crawl policy from `lib/seo/crawlers.ts`, with the sitemap named when indexing is on |
| `/sitemap.xml` | `app/sitemap.ts` | The public pages, absolute, with priorities. No `lastmod`: a timestamp that changes per request claims a change per request |
| `/manifest.webmanifest` | `app/manifest.ts` | The web-app manifest, in the base theme's colours |
| `/opengraph-image`, `/twitter-image` | `app/opengraph-image.tsx` | The share card, rendered from the copy and the palette so it cannot fall behind either. X reads the same image |
| `/icon`, `/apple-icon` | `app/icon.tsx`, `app/apple-icon.tsx` | Generated icons, beside the committed `favicon.ico` |
| `/llms.txt` | `app/llms.txt/route.ts` | The product in plain Markdown for a language model (llmstxt.org) |
| the head of every page | `app/layout.tsx` → `lib/seo/metadata.ts` | `metadataBase`, the title template, description, keywords, Open Graph, Twitter card, robots directives, verification tags, and two `theme-color`s |
| the head of a public page | `lib/seo/metadata.ts` `publicPageMetadata` | Its own title and description, a canonical URL, and matching Open Graph fields |
| the landing page's body | `app/page.tsx` → `lib/seo/structured-data.ts` | A JSON-LD graph: `Organization`, `WebSite`, `WebApplication`, `FAQPage` |

The root layout is rendered per request (`dynamic = "force-dynamic"`): the
absolute URLs in the head come from `APP_URL`, and `next build` runs in a
container that has none. A canonical baked at build time would say
`localhost` on every page of the site.

### One source for what the site says

`lib/seo/site.ts` holds the identity — name, tagline, description, language,
keywords — and the list of public pages. `lib/landing/rooms.ts` holds the six
things a learner does and `lib/landing/faq.ts` the questions a visitor asks,
with every figure in them computed from the same constants the product runs
on (`MAX_MINI_LEVEL`, `GUIDED_HOURS`, `timelinePhrase`, `TUTOR.name`). The
landing page, the structured data and `llms.txt` all read from these, so a
search engine, an answer engine and a browser tab are told the same thing,
and a retuned number changes everywhere at once.

The FAQ is visible on the page as headings and paragraphs, not in a
disclosure widget: Google honours FAQ markup only where the page shows the
same text, and a test holds the two lists equal.

## The crawl policy

`lib/seo/crawlers.ts`. Two shapes:

- **Not indexable.** One rule, `User-Agent: *` / `Disallow: /`, the one
  directive every crawler honours.
- **Indexable.** `*` may read everything except the private paths. The
  answer engines are then named one by one — OpenAI's three agents,
  Anthropic's three, Perplexity's two, `Google-Extended`, `Applebot-Extended`,
  `Bingbot`, and the rest — with the same allow and the same disallows. Not
  because their policy differs, but so that letting them in is a decision
  that appears in the file rather than a default nobody chose. An answer
  engine that can read the landing page can say what the product is when
  someone asks; one that cannot answers from whatever a competitor wrote.

The general block also carries a content signal, `search=yes, ai-input=yes`:
the site may be searched and quoted. Whether it may be used for training is
a business decision that has not been taken, so `ai-train` is not stated
either way. Change `CONTENT_SIGNAL` when it is.

## Keeping the rooms out

`lib/seo/private-paths.ts` names them: the route handlers, chat, curriculum,
dashboard, onboarding, review, scenarios, settings, trainer. A test holds the
list against the prefixes the proxy guards. Each is kept out three ways,
because no single one is honoured by every bot:

1. `Disallow` in robots.txt, for every agent.
2. `<meta name="robots" content="noindex, nofollow">` from the `(app)`
   layout, the onboarding page and the not-found page.
3. `X-Robots-Tag: noindex, nofollow` on the response, from `next.config.ts`,
   for the bare path and everything under it — which is the only one of the
   three a route handler can carry, having no head.

The proxy's matcher leaves the crawler files alone (`robots.txt`,
`sitemap.xml`, `manifest.webmanifest`, `llms.txt`, the images), so a fetch of
any of them costs no session refresh. The names are anchored: `icon` must
not also exclude `/iconography`, and a test checks it.

## Checking it

```bash
# The shape of the deployment, as a crawler sees it
curl -s https://<origin>/robots.txt
curl -s https://<origin>/sitemap.xml
curl -s https://<origin>/llms.txt | head -20
curl -sI https://<origin>/dashboard | grep -i x-robots-tag     # noindex, nofollow
curl -sI https://<origin>/api/health | grep -i x-robots-tag    # noindex, nofollow
curl -s https://<origin>/ | grep -o '<link rel="canonical"[^>]*>'
```

- Structured data: paste the landing page URL into
  [validator.schema.org](https://validator.schema.org/) or Google's
  [Rich Results Test](https://search.google.com/test/rich-results). Expect an
  `Organization`, a `WebSite`, a `WebApplication` and an `FAQPage`.
- The share card: `/opengraph-image` in a browser, or the URL in a chat
  client's preview.
- Search Console and Bing Webmaster Tools: set the two verification
  variables, redeploy, then verify with the HTML-tag method and submit
  `/sitemap.xml`.
- Locally: `SEO_INDEXING=true APP_URL=http://localhost:3000 pnpm dev:learner`
  and the same `curl` lines. Without the variable the site is, correctly,
  unindexable.

The Playwright spec `tests/e2e/seo.spec.ts` runs the production build with
`SEO_INDEXING=true` and asserts all of the above over real requests.

## The operator app

Never indexable, and there is no switch. `apps/ops/app/robots.ts` turns
every agent away from everything, every response carries
`X-Robots-Tag: noindex, nofollow, noarchive`, and the root layout has carried
`noindex, nofollow` since the app was split out. A security test holds all
three and asserts that no sitemap, no `llms.txt` and no share card exist
there.

## What is not built

- **No content pages.** There is no blog, no glossary, no "learn German"
  landing pages per topic. Search traffic to a three-page site is traffic to
  its name; anything more needs pages worth reading, and those are a product
  decision before they are an engineering one.
- **One language, no `hreflang`.** The site is in English for English
  speakers. If a German-language edition arrives it needs `alternates.languages`
  in the metadata and in the sitemap.
- **No IndexNow or ping.** Search engines find changes by recrawling. The
  public pages change on deploy and rarely, so this costs nothing yet.
- **No crawler analytics.** Which agents fetch `llms.txt` or the landing
  page is not counted anywhere; the platform's request logs are the only
  record.
- **The share card is one card.** Every public page shares it. A page-specific
  card would be `opengraph-image.tsx` in that page's segment.
- **The training signal is unstated.** See the crawl policy above.
