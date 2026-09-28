Deutsch Partner — plans, entitlements and payments.

Authoritative for: what each plan includes, how a learner's plan is decided,
how money is taken, and what a plan may and may not change about the tutor.
Depends on security-observability-guardrails.md (document 3) and
model-routing-and-cost-control.md (document 4), and yields to both. Where this
document and document 4 disagree about a tier or a ceiling, document 4 wins
and this one is wrong.

==================================================
1. WHAT THIS IS, AND WHAT IT IS NOT
==================================================

Three plans — Free, Plus, Premium — sold as monthly or annual subscriptions,
plus one-off Passes that grant a plan for a fixed number of days. Payment is
taken by Stripe on Stripe's own hosted pages. This application never sees a
card number, an IBAN, or a Klarna credential, and never stores one.

It is not a way to sell progress. A plan buys convenience, depth and volume.
It never buys a level, a mastery verdict, or a different grade for the same
German. Section 4 is the list of things no plan changes, and it is the part of
this document most worth defending.

Steady growth is the commercial intent. Free must be a real product that a
learner can reach A1 on without paying, because word of mouth from learners
who were never asked for a card is the cheapest acquisition this product will
ever have. Paid plans must be profitable at the per-learner level on the day
they launch — see section 9 — so growth never has to be subsidised.

==================================================
2. PLANS
==================================================

Plan codes are a closed set: free | plus | premium. The code is the only
identity a plan has inside the application; names shown to learners live in
the plan catalogue (packages/domain/src/plans.ts) and may change freely.

The catalogue is normative for everything below except prices. Prices are
never in code (section 7).

  Dimension                        free        plus         premium
  -------------------------------  ----------  -----------  -----------
  Tutor intelligence (tier)        mid         strong       strong
  Tutor context (conversation      level       level        widened:
    .turn ceilings)                table       table        A1 5000/400
                                                            A2 6500/600
                                                            B1 8000/1000
  Knowledge snippets per turn      3           5            5
  Trainer intelligence (tier)      mid         strong       strong
  Trainer per-request EUR bound    0.02        0.05         0.05
  Tutor turns per 24h              20          150          300
  Trainer requests per 24h         15          100          200
  Transcriptions per 24h           5           60           200
  Model voice lines per 24h        0           150          400
  Hands-free conversation mode     no          no           yes
  Voice in the Trainer             no          no           yes
  Milestone readiness reports      no          no           yes (when built)
  Long-term tutor memory           no          no           yes (when built)

"Per 24h" is a fixed window that opens on the first use and closes 24 hours
later. It is counted by the same Postgres fixed-window mechanism as the
per-minute rate limits (guardrails S7), keyed by pseudonym, never by id.

Free's browser voice — the device's own speech synthesis — is unlimited on
every plan. It costs nothing and it is how a free learner hears German.

The per-minute rate limits in apps/learner/lib/api/rate-limit.ts stay exactly
as they are for every plan. They bound how fast; the daily quotas bound how
much; the euro budgets (section 9) bound what it costs. All three are required.

==================================================
3. INTELLIGENCE LEVELS
==================================================

"Intelligence" is four things, in this order of cost:

1. The tier conversation.turn and trainer.session run on.
2. How much context a turn may carry (the input ceiling) and how long a reply
   may be (the output ceiling).
3. How much retrieved knowledge a turn is given.
4. Features that add model calls: memory, milestone reports, hands-free voice.

A plan changes these only through the routing table. Document 4 S4's rule
stands: a caller never chooses a tier. What changes is that the table itself
may carry a byPlan entry beside byLevel:

  byPlan: Partial<Record<PlanCode, { tier?: Tier;
                                     byLevel?: Record<CEFRLevel, TokenCeilings> }>>

Rules for byPlan, each asserted by a test in packages/domain:

- A plan entry may move the tier DOWN the chat ladder from the task's own
  tier, never up. The task's row is the maximum any plan may reach.
- A plan entry's ceilings never exceed the task's row, and never exceed the
  hard maxima of the tier the plan entry names.
- The plan is resolved on the server from entitlement rows (section 5). It is
  never read from a request body, a header, a cookie or a client claim.
- A call with no plan resolves exactly as it did before byPlan existed. The
  learner-facing routes always pass one.
- Budget degradation (document 4 S9) steps one rung down from the plan's
  tier, not the table's. A free turn under budget pressure runs on cheap.

Only conversation.turn, conversation.repair and trainer.session carry byPlan
entries. Adding one to any other task is an edit to this document first.

Document 4 S3 says strong is the only tier permitted on the streaming hot path.
It is amended by this document: mid is also permitted there for the free plan,
exactly as budget degradation already permits it.

Evaluation before downgrade (document 4 S11) applies. The free plan's mid-tier
tutor ships with the golden-set gap stated in docs/architecture.md, and the
first eval set written is the conversation set, comparing free and plus.

==================================================
4. WHAT NO PLAN CHANGES
==================================================

These are identical on every plan, and a test asserts the routing table has
no byPlan entry for any task that produces them:

- evaluation.learner_message, extraction.errors, extraction.vocabulary_usage,
  trainer.answer_analysis, trainer.session_mining. They write learner state.
  A cheaper evaluator for free learners would make a level mean less on Free.
- every assessment.* task. A level is a level.
- classification.safety_screen. Safety is not a feature.
- every deterministic rule: mastery, progression, review scheduling,
  recommendation ranking, the behaviour policy.

And these are never gated, on any plan, for any reason:

- /review, /curriculum, /dashboard, comprehension scenarios. They cost
  nothing in model spend, and blocking spaced repetition breaks the ladder a
  learner has already climbed.
- The learner's own data: reading it, and (when built) exporting and deleting
  it.
- Browser voice.
- Moving between levels. "No locked chapters" stays true.

A quota never interrupts a Trainer agenda midway or discards a turn the
learner has already written: a refused request returns the draft, says when
the window reopens, and says that progress is saved. Every Trainer request is
counted; once the day's are spent, a request that opens a session is refused,
and one that continues a session under way runs from a bounded daily
overdraft (twice the longest agenda) instead. A quota is counted only for a
request that has passed its own checks, and a quota store that cannot count
is an outage, never a spent day.

==================================================
5. ENTITLEMENT
==================================================

A learner's plan is the highest-ranked plan among their current grants, or
free when there are none. Ranking: premium > plus > free.

Grant sources:

1. A subscription row whose status is active, trialing or past_due.
   past_due is Stripe's retry window; access continues through it because the
   learner has not yet failed to pay, only failed once. incomplete,
   incomplete_expired, unpaid, canceled and paused grant nothing.
   A subscription with cancel_at_period_end still grants until it ends.
2. A pass row whose [starts_at, ends_at) contains now and that is not revoked.
3. An operator comp (plan_comps): a plan given rather than sold. Its window is
   [starts_at, ends_at) with a null ends_at granting until revoked, and a
   revoked comp grants nothing. A comp carries a reason code, never free text,
   and is written only through the secret key — the learner can read their own
   comp rows and nothing more, exactly as with the other grants. No Stripe
   object stands behind it, so the webhook never touches it.

Resolution is a pure function in packages/domain/src/entitlement.ts over rows
already read, so it is tested without a database. It returns the plan, which
source granted it, and until when.

Paid entitlement is written by exactly one path: the Stripe webhook (section
8), through the secret-key client. Comps are written through the same
secret-key client by the operator, never from Stripe. The learner can read
their own billing rows and nothing else; RLS grants select only. The success
redirect after Checkout grants nothing — it is a page that waits for the
webhook.

==================================================
6. PAYMENT METHODS
==================================================

Stripe Checkout, hosted, in two modes:

- subscription mode for Plus and Premium, monthly or annual;
- payment mode for Passes.

Payment methods are Stripe's dynamic payment methods, chosen in the Stripe
Dashboard, never in code: the Checkout call passes no payment_method_types.
That is how cards (Visa, Mastercard, Amex), Apple Pay and Google Pay (which
ride the card method), Klarna, SEPA Direct Debit, PayPal and Link are switched
on or off without a deploy, and how Stripe shows each learner only the methods
that work for their country, currency and mode. Klarna is expected to appear
for Passes everywhere it operates and for subscriptions only in the markets
Stripe supports it for recurring use; the code does not assume either.

Managing a subscription — changing plan, updating a card, cancelling,
downloading invoices — is Stripe's Customer Portal, reached from /billing.
Klarna and iDEAL payment methods cannot be managed there; a learner paying
that way changes method by cancelling and re-subscribing, and /billing says so.

The order is placed in this application, not on Stripe's page. German law
(§312j BGB) requires the button that places a paid order to say so
unambiguously, and OLG Düsseldorf (20 UKl 4/23) held that "Abonnieren" does
not; hosted Checkout's subscription-mode button text cannot be changed. So:

1. /billing/checkout?offer=<key> is an order page. Directly above its button
   it states the plan's main features, the total price including VAT, the
   billing interval, that it renews until cancelled, and how to cancel. It
   carries one unticked checkbox: the learner asks for the service to start
   immediately and acknowledges the withdrawal consequence (section 11).
2. Its button reads "Order with obligation to pay". Pressing it records the
   order and the consent (billing_checkouts), then creates the Checkout
   Session and redirects to it. Stripe's page collects the payment method
   for an order already placed.
3. A Checkout Session is never created for an order without that record.

Checkout is created with:

- the learner's Stripe customer (created on first checkout, section 8);
- allow_promotion_codes, for founding-member and partner codes;
- automatic tax when STRIPE_AUTOMATIC_TAX is on (Stripe Tax registered);
- custom submit text restating that the order was placed and what it costs;
- success_url and cancel_url built from APP_URL, never from a request header;
- client_reference_id set to the billing_checkouts id, for corroboration.

Trials. Premium offers one 7-day trial per learner, ever, with no card
collected (payment_method_collection if_required) and no automatic
conversion (trial_settings.end_behavior.missing_payment_method = cancel).
A trial that cannot turn into a charge places no paid order, which is why it
needs no order page and no withdrawal consent. It is the only trial.

Because missing_payment_method only acts when no payment method exists, the
trial is also made structurally unable to charge:

- the webhook sets every trialing subscription to cancel at its period end
  on first sight, and again whenever it finds that switched off;
- the Customer Portal is not offered while the trial is a learner's only
  subscription;
- the trial is not a subscription for the purpose of ordering: a learner on
  it orders a paid plan on the order page, like anyone else;
- a trial's Checkout Session expires after 35 minutes, and a second trial
  checkout is refused while an earlier one could still be completed, decided
  under a per-learner lock (billing_open_trial_checkout).

==================================================
7. PRICES
==================================================

Stripe is the source of truth for every price. A price in code is a figure
that goes quietly stale, and rule 3 fails the build on one.

Each sellable offer has a Stripe lookup key:

  dp_plus_month   dp_plus_year   dp_premium_month   dp_premium_year
  dp_pass_plus    dp_pass_premium

A Price carries metadata plan_code and, for a pass, pass_days. Amounts are VAT
inclusive (tax_behavior inclusive), because EU consumers are shown what they
pay.

billing_prices mirrors the active Prices, one row per price and currency, with
unit_amount in integer minor units and a fetched_at stamp. It is refreshed by
`pnpm --filter @dp/billing prices:sync`, and the pricing page reads it. A
pricing page with no rows says prices are unavailable rather than inventing
them. Multi-currency is Stripe's currency_options on the same Price, mirrored
as extra rows; nothing here assumes euro except the default.

The catalogue of amounts used to create the Prices in a new Stripe account
lives in packages/billing/catalogue.json, in integer cents, and is applied by
`pnpm --filter @dp/billing stripe:bootstrap`, which refuses a live key.

==================================================
8. THE WEBHOOK
==================================================

POST /api/billing/webhook on the learner app. It has no session: the Stripe
signature is its authentication.

1. Read the raw body. Verify the stripe-signature header against
   STRIPE_WEBHOOK_SECRET before any parse, any log line with content, or any
   database access. A bad signature is 400 with no detail. A request with no
   signature header is refused before its body is read, and a body is read
   to at most 1 MiB, counted in bytes as it arrives.
2. Claim the event id in billing_events. A duplicate that was processed is
   200 and nothing else.
3. Apply it: for any subscription event, retrieve the subscription fresh from
   Stripe and upsert the row from what Stripe says now. Out-of-order delivery
   cannot regress state because nothing is applied from a stale payload.
   The plan a Price sells is its lookup key's; for a Price whose key moved
   to a new Price (a price change), the price mirror's record of that Price
   id; failing both, its plan_code metadata. Our own customer on a Price none
   of these places is a failure, retried, not an acknowledgement.
4. Mark the event processed. On failure, mark it failed with an error code
   and return 500 so Stripe retries; Stripe's retry schedule is the queue.

Handled: checkout.session.completed, checkout.session.async_payment_succeeded,
checkout.session.async_payment_failed, checkout.session.expired,
customer.subscription.created,
customer.subscription.updated, customer.subscription.deleted,
customer.subscription.paused, customer.subscription.resumed, invoice.paid,
invoice.payment_failed, charge.refunded. Anything else is recorded and
acknowledged.

The learner is found from the stored stripe_customer_id mapping, which was
written when the server created the customer for an authenticated session.
client_reference_id and metadata are corroboration, never the key.

The webhook path is excluded from the session-refreshing proxy matcher.

==================================================
9. MONEY BOUNDS AND MARGIN
==================================================

Every plan has a per_user_monthly euro budget, held in budget_limits with
scope_key 'plan:<code>'. budget_snapshot resolves a learner's limit in this
order: the learner's own override, then their plan's row, then the scope
default. The gateway passes the plan with the pseudonym.

A paid plan's monthly euro bound is set below the plan's net monthly revenue,
so no learner, however heavy, is served at a loss: when a learner reaches 90%
of it they are degraded one tier (document 4 S9), and at 100% they are denied
until the month turns, with an explanation. Starting values, which the
operator changes on the budgets page and not in code:

  plan:free      per_user_monthly   1.00
  plan:plus      per_user_monthly   4.00
  plan:premium   per_user_monthly   9.00

The paid bounds are sized against the annual price, which is the smaller
monthly revenue: at the catalogue's amounts an annual Plus learner brings in
about 4.70 a month after VAT and fees, an annual Premium learner about 9.80.
The bound is where a heavy learner stops being served at a loss, not a target.

Voice is not yet in the ledger (docs/architecture.md). Until it is, voice is
bounded by the daily voice quotas above and the per-minute rate limits, and
the operator treats premium voice margin as unmeasured.

==================================================
10. DATA
==================================================

Learner-owned, select-only for the learner, written by the secret key:

  billing_customers   learner_id -> stripe_customer_id
  billing_checkouts   one row per order placed on the order page: offer,
                      terms version, early-start consent time, and the
                      Checkout Session it led to. The evidence that the
                      order and the consent happened.
  subscriptions       one row per Stripe subscription
  plan_passes         one row per paid pass

Each references profiles and is therefore deleted with the account and
included in ops_learner_export.

Operator scope, RLS on and no policy:

  billing_prices      the price mirror (read server-side for the pricing page)
  billing_events      the webhook inbox: event id, type, status, error code

No table stores a card, an IBAN, a billing address, a name or an email.
Invoices stay in Stripe, which the Customer Portal shows the learner.

Account deletion must cancel an active subscription first (not built: the ops
deletion action refuses while one is active is the next step).

==================================================
11. CONSUMER LAW (DE/EU)
==================================================

The seller is a registered German business selling a digital service to
consumers. This section is a checklist for a lawyer to confirm, not legal
advice. Built with B5:

- Prices shown VAT inclusive, with "incl. VAT" beside them. An annual price
  shown per month also shows the annual total (PAngV).
- The order page and its "Order with obligation to pay" button (section 6).
- The early-start request: an AI tutor is a digital service (§356(4) BGB),
  so the 14-day right does not lapse on first use. The learner asks for an
  immediate start and acknowledges that withdrawing within 14 days means
  paying for the days used (§357a(2)). Unticked by default, recorded with a
  timestamp and the terms version.

Before the live-mode Stripe key is configured (B10), none optional:

- A cancellation button (§312k BGB), "Cancel contracts here", in every page
  footer, working without signing in, leading to a page that holds only the
  form and a "Cancel now" button — no retention offer (BGH I ZR 200/25). It
  applies to passes as well as subscriptions (BGH I ZR 161/24). Confirmed
  immediately in text form, which needs an email sender this product does
  not yet have.
- A withdrawal button (§356a BGB, since 19.06.2026), "Withdraw from
  contract", for the 14 days, two steps, confirmed in text form. It may sit
  behind sign-in because an account was needed to contract.
- Annual renewal (§309 Nr. 9 BGB): the first year is fixed; after it, the
  plan continues but may be cancelled at any time with at most one month's
  notice, refunding unused whole months. It never renews into a second fixed
  year.
- Impressum (§5 DDG), terms, privacy policy (voice is personal data; data
  processing agreements with OpenRouter and Stripe), withdrawal instructions
  with the model form.
- EU AI Act Art. 50: the tutor says it is an AI, and synthetic speech is
  marked as such.

Kleinunternehmer status, OSS registration and whether Stripe Tax or a
merchant of record fits are questions for a Steuerberater. The code supports
Stripe Tax behind a flag and assumes nothing else.

==================================================
12. SECRETS
==================================================

  STRIPE_SECRET_KEY       learner app only. Never ops; not the worker until a
                          reconcile job exists.
  STRIPE_WEBHOOK_SECRET   learner app only.
  STRIPE_AUTOMATIC_TAX    learner app, not a secret.

No publishable key: hosted Checkout needs none. Each is declared in
packages/env, empty in apps/learner/.env.example, refused at boot by the ops
app, and absent from every Client Component (security-tests).

==================================================
13. OBSERVABILITY
==================================================

Audit events: billing.checkout_started, billing.portal_opened,
billing.webhook_rejected (bad signature), billing.subscription_changed
(from/to plan and status), billing.pass_granted, billing.event_failed.

Never logged: a Stripe object, an event body, a customer email, an address, a
card brand or last four. Event id, event type, plan code, status and the
learner's pseudonym are enough to follow any payment.

==================================================
14. BUILD ORDER
==================================================

B1  Domain: plan catalogue, entitlement resolution, byPlan routing.
B2  Data: tables, RLS, export, repositories.
B3  @dp/billing: Stripe provider, mock, webhook application, price sync.
B4  Env and security tests.
B5  Learner app: /pricing, /billing, checkout and portal actions, webhook.
B6  Enforcement: plan resolved per request, daily quotas, plan routing,
    plan budgets, upgrade prompts.
B7  Hands-free conversation mode for Premium.
B8  Voice in the ledger.
B9  Ops: revenue and margin per plan, comps, refunds through worker jobs,
    reconciliation job.
B10 Consumer-law pages, the cancellation button, Stripe Tax live.
