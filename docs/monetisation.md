# Monetisation

The business plan for making Deutsch Partner pay for itself, and then some,
through steady growth rather than fast money. It is written for the founder:
someone who can read the code but does not do finance for a living.

The rules live in
[`.claude/docs/billing-and-plans-spec.md`](../.claude/docs/billing-and-plans-spec.md):
what each plan includes, how entitlement is decided, how money is taken. This
document is the business case behind those rules and the plan for growing into
them. Where the two disagree, the spec wins, and this document is wrong.

**How to read the numbers.**

- **Prices** are the catalogue's planning amounts, VAT included. The live price
  is whatever Stripe holds, mirrored into `billing_prices`. If a price
  changes, redo section 3.
- **AI costs are estimates, not measurements.** They come from
  [operations.md](operations.md#cost). No chat model has ever been called
  outside tests, and the pricing snapshot job has never run
  ([architecture.md](architecture.md#what-is-not-built)). Replacing them with
  real ledger figures is the first job after launch.
- **Benchmarks** come from market research dated 2026-09-25, cited inline.
  Figures marked *our target* are recommendations, not benchmarks.
- **Legal points** are a checklist to take to a lawyer and a Steuerberater.
  They are not advice.

## Contents

1. [The model in one page](#1-the-model-in-one-page)
2. [The journey from A1 to B1, and where each plan earns its keep](#2-the-journey-from-a1-to-b1-and-where-each-plan-earns-its-keep)
3. [Unit economics per plan](#3-unit-economics-per-plan)
4. [Competitive position](#4-competitive-position)
5. [Growth plan](#5-growth-plan)
6. [Features to add](#6-features-to-add)
7. [Legal and tax must-dos before taking real money](#7-legal-and-tax-must-dos-before-taking-real-money)
8. [Risks, and how the design contains them](#8-risks-and-how-the-design-contains-them)

---

## 1. The model in one page

Deutsch Partner sells **convenience, depth and volume**. It never sells a
level, a mastery verdict or a better grade for the same German. Every chapter
is open on every plan, review is free forever, and a level means the same
thing whether the learner pays or not.

| Offer | Price (incl. VAT) | Per 30 days | Who it is for |
| --- | --- | --- | --- |
| **Free** | €0 | €0 | Everyone, first. A real product: a learner can reach A1 on it |
| **Plus** monthly | €9.99 | €9.99 | The regular learner. **The main product** |
| **Plus** annual | €69.99 | €5.83 | The committed learner, and cash up front |
| **Premium** monthly | €19.99 | €19.99 | Power users, voice-first learners, exam candidates |
| **Premium** annual | €139.99 | €11.67 | The same, committed |
| **Plus Pass**, 180 days | €44.99 | €7.50 | A goal with a date: "A1 before I move" |
| **Premium Pass**, 90 days | €49.99 | €16.66 | A sprint: "B1 exam in three months" |
| **Premium trial**, 7 days | €0 | — | One per learner, ever. No card. Does not convert automatically |

Annual plans are about 42% below twelve months of monthly, inside the
market's 40–60% band (Duolingo's annual is about 41% of twelve months of
monthly, Speak's about 39%).

### Why freemium with caps, not a hard paywall

A hard paywall converts far better in the short run. RevenueCat's 2026 data
across 115k apps puts day-35 download-to-paid at **10.7% for hard paywalls
against 2.1% for freemium**, and day-60 revenue per install at $3.09 against
$0.38 ([RevenueCat 2026 trends][rc-trends]). That is the fast-money route, and
it works best with paid acquisition feeding it.

Deutsch Partner takes the other route, on purpose:

- **Word of mouth is the cheapest acquisition there is.** It comes from
  learners who were never asked for a card. The landing page already promises
  "Start free", "No card" and "no locked chapters", and those promises are
  part of the product.
- **Caps limit usage, never content.** Three bounds work together. Per-minute
  rate limits bound how fast, per-24-hour quotas bound how much, and a monthly
  euro budget per plan bounds what it costs. Nothing is locked.
- **The price of the choice** is a lower conversion rate. It only pays off if
  free learners stay cheap to serve, and section 3.6 shows that this is the
  single number most likely to decide whether the business makes money.

### Why Plus is the main product

- **It is priced under the market's middle tier.** Competitors cluster at
  $14–20 a month and $60–120 a year (section 4). Plus is €9.99
  and €69.99, VAT included.
- **It is the whole tutor.** The strong tier for the tutor and the Trainer,
  150 tutor turns a day (no honest learner reaches that), 100 Trainer requests
  and model voice. A regular learner has no reason to want more.
- **It carries the margin.** Monthly Plus leaves about €5.60 a month after
  VAT, fees and typical AI cost; annual Plus leaves less, paid up front
  (section 3.4). Aim for most payers on Plus, and Premium as a smaller group.

### Why Premium exists, and what it is not

Premium is for learners who want more: wider context (longer, richer B1
replies), hands-free conversation, voice in the Trainer, milestone reports and
long-term memory. Sell it on **outcomes**, meaning readiness, personalisation
and exam preparation, and not on voice alone. Duolingo is moving its AI video
call down into its middle tier because each call now costs under a cent
([Motley Fool][fool], [TIKR][tikr]). Voice is becoming a middle-tier feature
across the market. Premium's margin is also the one most exposed to voice cost
(section 3.5).

### Why passes

- **Education apps sell annual plans well and renew them badly.** The median
  first annual renewal in Education is **24%**, the lowest of any category,
  against 56% for monthly plans ([RevenueCat renewal rates][rc-renewal]).
  Learners buy for a goal and leave when they reach it or give up. A pass
  sells exactly that goal, with no renewal to disappoint.
- **The durations match the curriculum.** 180 days at 30 minutes a day is
  **90 hours, the guided hours for A1**. 90 days at an hour a day is a serious
  exam sprint. (Guided hours are a guide, not a promise.)
- **Passes suit the payment methods people like.** Klarna's fixed fee hurts a
  €9.99 charge and barely matters on a €44.99 one (section 3.2), and one-off
  payments can use methods that subscriptions cannot.
- **They work as gifts and B2B vouchers** (section 5).
- The cancellation button law still applies to passes (section 7).

### Why one trial, with no card

One 7-day Premium trial per learner, ever. No card is collected and nothing
converts automatically. It lets Plus and Free learners feel the top tier, it
cannot surprise anyone with a charge, and it avoids the German rule against
"free trial" buttons that quietly become paid orders. Expect it to convert
worse than a card-up-front trial; that is the price of trust, and the
conversion rate is a number to measure, not assume.

### The three rules that keep it profitable

1. **Each paid plan's monthly euro cap sits below its smallest monthly net
   revenue**, which is the annual price spread over twelve months. No learner,
   however heavy, is served at a loss.
2. **Free has its own small cap (€1.00 a month)** and runs the tutor on the
   mid tier.
3. **No price is written into code.** Plan prices come from Stripe, and model
   prices come from `model_pricing_snapshots` with a `fetched_at` stamp (repo
   rule 3). When a model gets cheaper or dearer, the numbers follow without a
   deploy.

---

## 2. The journey from A1 to B1, and where each plan earns its keep

### 2.1 The ladder in numbers

The course has **70 mini-levels**: A1 is levels 1–15, A2 is 16–35 and B1 is
36–70. The landing page quotes guided hours of **90 for A1, 200 cumulative for
A2 and 350 cumulative for B1**, which sit in the middle of the Goethe-Institut's
80–200 units per level.

| Band | Mini-levels | Hours in band | Cumulative hours | Hours per mini-level | At 30 min/day | At 60 min/day |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 1–15 | 90 | 90 | 6.0 | 180 days (~6 months) | 90 days (~3 months) |
| A2 | 16–35 | 110 | 200 | 5.5 | +220 days, ~13 months in total | +110 days, ~6.5 months in total |
| B1 | 36–70 | 150 | 350 | 4.3 | +300 days, ~23 months in total | +150 days, ~11.5 months in total |

At 30 minutes a day, one mini-level takes about 12 days in A1, 11 in A2 and 9
in B1. A learner who goes the whole way is a customer for **one to two years**.
That favours subscriptions over lifetime deals, and it makes the long middle
the part of the journey to design for.

**The gate** that clears a mini-level is plain arithmetic: at least 7
evaluated turns, with 80% of them strong (the learner may lower the pass mark
to 50% or 33%). The model never decides a level. Mastery opens the gate and
the learner chooses **Move on** or **Keep practising**.

### 2.2 The moments that matter

| # | Moment | When it happens | Plan carrying it | Upgrade prompt? |
| --- | --- | --- | --- | --- |
| 1 | **First reply** at the learner's level, with a gentle recast | Turn 1, about two minutes after sign-up | Free | **Never** |
| 2 | **First level cleared**: the banner after 7 evaluated turns | 15–30 minutes in | Free | Not on the banner. The moment belongs to the learner |
| 3 | **"It remembers what I get wrong"**: the dashboard's mistakes list, with honest counts | The first days | Free | No |
| 4 | **First Trainer session**, ending in a recap and a news retelling at their level | From the middle of A1 | Free (15 requests a day is about one short session) | Only after the session ends, never during it |
| 5 | **The daily quota runs out** | A daily learner on Free, after 20 turns | Free → Plus | **Yes.** This is the main honest prompt |
| 6 | **A1 done**: 15 → 16, and the companion's second stage | 3–6 months in | Plus, Plus Pass | **Yes, the best moment of all.** Value is proven and 110 hours of A2 lie ahead |
| 7 | **The A2 plateau**: 20 mini-levels, 110 hours | Months 4–13 at 30 min/day | Plus | Rarely. This stretch needs retention, not selling |
| 8 | **Into B1**: 35 → 36, the A2 milestone | ~13 months at 30 min/day | Plus, or a Premium trial if unused | Yes: the Premium trial, or a milestone report |
| 9 | **B1 readiness**: late B1, or an exam booked | ~2 years at 30 min/day | Premium, Premium Pass | Yes: an exam-prep offer, always as a *readiness estimate*, never certification |

**The A2 plateau is where the business is won or lost.** The novelty is gone,
each level feels like the last, and the learner has seven or more months of it
ahead at 30 minutes a day. Most of the features in section 6 that drive
retention are aimed here: streaks, weekly progress, life-admin scenarios and
writing correction.

### 2.3 Where each plan earns its keep

**Free: the first reply up to A1.** Twenty tutor turns a day is enough to
clear a mini-level every day or two. Clearing all of A1 takes at least 105
evaluated turns and realistically several hundred, all reachable without
paying. Review, the curriculum, the dashboard, comprehension scenarios and the
browser voice are unlimited on every plan, for good. A daily learner feels the
20-turn quota after about 20 minutes. That is the right tension: generous as a
trial, tight as a habit.

**Plus: the end of A1 through the A2 plateau.** The strong-tier tutor, 150
turns and 100 Trainer requests a day, and model voice. This is where most
learners spend most of their paid months.

**Premium: B1 and the exam.** Wider context where it matters most. B1 replies
may carry 8,000 input and 1,000 output tokens, against Plus's 6,000 and 700.
Premium also adds hands-free conversation, voice in the Trainer, milestone and
readiness reports and long-term memory.

### 2.4 Where upgrade prompts belong

- **When a daily quota runs out.** Show it after the turn is saved, never
  while one is in progress. The refusal returns the learner's draft, says when
  the window reopens and says their progress is saved. One line can then say
  what Plus gives.
- **On the dashboard**, as one quiet card (not a modal), after the first few
  cleared mini-levels.
- **At A1 completion**, beside the milestone line: what A2 involves, and what
  Plus or a Plus Pass adds.
- **Next to the speaker button** when the device voice is used because model
  voice is not on the plan. One line, no interruption.
- **At the A2 milestone and near B1**: the Premium trial, if unused, then the
  Premium Pass for an exam sprint.
- **On `/pricing` and `/billing`**, always; in a weekly progress email, once
  one exists, one footer line at most.

### 2.5 Where upgrade prompts must never appear

- **Before or during the first reply**, or anywhere in onboarding.
- **Mid-turn, or mid-way through a Trainer agenda.** Spec §4 forbids cutting
  off an agenda, and a cut-off at turn 5 of 7 wastes the learner's evidence.
- **On `/review` or in comprehension scenarios.** Spaced repetition is the
  habit loop. Blocking or cluttering it breaks a ladder the learner has
  already climbed.
- **On the level-cleared banner itself.**
- **In the tutor's own words.** The tutor never sells. Upgrade copy is
  interface text, never model output.
- **Tied to a level or a verdict.** Nothing may suggest that paying helps a
  learner pass.
- **On the cancellation page or in the withdrawal flow.** German law forbids
  retention offers there (BGH I ZR 200/25; see section 7).
- **In unrelated errors.** Today the chat route turns a budget denial into
  `generation_failed` ("Your tutor is unavailable right now"). Before any
  prompt depends on it, the route needs a closed `quota_exhausted` or
  `plan_required` error, and the clients need to branch on `body.error`
  rather than `body.message`.

---

## 3. Unit economics per plan

### 3.1 From the price a learner pays to the money you keep

German VAT is 19%, and every price is VAT-inclusive, so the net amount is the
price divided by 1.19. A learner in another EU country pays their own
country's rate once OSS applies (section 7). The 19% figure is the planning
case.

| Offer | Price | VAT (19%) | Net of VAT |
| --- | --- | --- | --- |
| Plus monthly | €9.99 | €1.60 | €8.39 |
| Plus annual | €69.99 | €11.17 | €58.82 |
| Premium monthly | €19.99 | €3.19 | €16.80 |
| Premium annual | €139.99 | €22.35 | €117.64 |
| Plus Pass (180 days) | €44.99 | €7.18 | €37.81 |
| Premium Pass (90 days) | €49.99 | €7.98 | €42.01 |

### 3.2 Payment fees: card, SEPA and Klarna

Stripe's German rates ([Stripe pricing][stripe-pricing],
[local payment methods][stripe-lpm]): **standard EEA cards** 1.5% + €0.25
(Apple Pay and Google Pay cost the same), premium EEA cards 2.8% + €0.25, UK
cards 2.5% + €0.25, international cards 3.15% + €0.25 plus 2% when currencies
are converted. **SEPA Direct Debit** €0.35 flat (a failed debit €3.50, a
dispute €15). **Klarna** 2.99% + €0.35. Card disputes €20. Subscriptions add
**Stripe Billing**'s 0.7%; a pass is a one-off payment and pays processing
only. **Stripe Tax** in Checkout adds 0.5%, charged only where you are
registered ([Stripe Tax pricing][stripe-tax]).

| Offer | Card + Billing | SEPA + Billing | Klarna + Billing | Stripe Tax (0.5%) |
| --- | --- | --- | --- | --- |
| Plus monthly €9.99 | €0.47 (4.7%) | €0.42 | €0.72 (7.2%) | €0.05 |
| Plus annual €69.99 | €1.79 (2.6%) | €0.84 | €2.93 (4.2%) | €0.35 |
| Premium monthly €19.99 | €0.69 (3.5%) | €0.49 | €1.09 (5.5%) | €0.10 |
| Premium annual €139.99 | €3.33 (2.4%) | €1.33 | €5.52 (3.9%) | €0.70 |
| Plus Pass €44.99 | €0.92 (2.0%) | €0.35 | €1.70 (3.8%) | €0.22 |
| Premium Pass €49.99 | €1.00 (2.0%) | €0.35 | €1.84 (3.7%) | €0.25 |

What this means:

- **SEPA is the cheapest method** on every plan, and Germans use it. Leave it
  switched on.
- **Klarna costs half as much again as a card** on a monthly plan. It suits
  passes and annual plans. Payment methods are switched in the Stripe
  Dashboard, not in code, so if Klarna's share of monthly plans grows, turn it
  off for subscriptions without a deploy. Klarna subscriptions also cannot be
  managed in the Customer Portal ([Stripe Klarna][stripe-klarna]).
- **The fixed per-payment fee hurts small monthly charges most.** This is one
  more reason to steer committed learners to annual plans or passes.
- **Merchant-of-record options cost much more** (section 5, stage 4). On
  €9.99, Stripe Managed Payments comes to about €0.82 and Paddle to about
  €0.93, against €0.47 for Stripe direct.

### 3.3 AI cost per learner

The costs per call below are the documented estimates (see "How to read the
numbers" above).

| Call | Tier | Estimated EUR | Note |
| --- | --- | --- | --- |
| A1 tutor turn as wired: `conversation.turn` + `evaluation.learner_message` | strong + mid | **≈ 0.0054** | operations.md gives €0.0064, but two of its five calls are not wired yet |
| B1 tutor turn | strong + mid | ≈ 0.008–0.012 | Ceilings are 1.5× larger for input and 2.3× for output |
| Free tutor turn | mid + mid | ≈ 0.002 | An inference from the cost of the evaluation call on the same tier. Not measured |
| Trainer request | strong + cheap | ≈ 0.01–0.035 | Hard bound per request: €0.05 on Plus and Premium, €0.02 on Free |
| Trainer session mining | cheap | ≤ 0.01 per session | Once, after a completed session |

Typical and heavy usage per month (text only, before voice):

| Profile | Assumed month | Estimated AI cost |
| --- | --- | --- |
| Free, typical active | 5 days × 10 turns, plus one short Trainer session | ≈ €0.10–0.20 |
| Free, daily | 30 days at the 20-turn quota, plus the Trainer | Reaches the **€1.00 cap** |
| Plus, light | 12 days × 15 turns | ≈ €1.00 |
| **Plus, typical (planning case)** | 15 days × 20 turns (A1/A2), plus 5 Trainer sessions | **≈ €2.30** |
| Plus, heavy daily B1 | 20 days × 30 turns at B1, plus 10 Trainer requests a day | €6–7+, **capped at €4.00** |
| **Premium, typical (planning case)** | 18 days × 30 turns with wider context, plus 8 Trainer sessions | **≈ €5.30** |
| Premium, heavy | Daily, near the quotas | **Capped at €9.00** |

**The worst case is the cap**, and nothing more. A learner who reaches 90% of
their plan's monthly budget drops one tier (strong to mid, with half the
output ceiling). At 100% they are refused until the calendar month turns, and
told why. The starting caps from spec §9 are **€1.00 for Free, €4.00 for Plus
and €9.00 for Premium**, set on the operator's budgets page and not in code.

### 3.4 Margin per plan

All figures are per month, or per 30 days for passes, with card payment and
Stripe Tax switched on.

| Offer | Net after VAT, card fee and Stripe Tax | Typical AI | **Margin, typical** | AI cap | **Margin at cap** |
| --- | --- | --- | --- | --- | --- |
| Plus monthly | €7.87 | €2.30 | **€5.57** | €4.00 | €3.87 |
| Plus annual | €4.72 | €2.30 | **€2.42** | €4.00 | €0.72 |
| Premium monthly | €16.01 | €5.30 | **€10.71** | €9.00 | €7.01 |
| Premium annual | €9.47 | €5.30 | **€4.17** | €9.00 | €0.47 |
| Plus Pass | €6.11 | €2.30 | **€3.81** | €4.00 | €2.11 |
| Premium Pass | €13.59 | €5.30 | **€8.29** | €9.00 | €4.59 |

The same figures over a year:

| Offer | Net revenue per year | Typical AI per year | Margin per year |
| --- | --- | --- | --- |
| Plus annual | €56.68 | €27.60 | €29.08 |
| Plus monthly, if kept 12 months | €94.44 | €27.60 | €66.84 |
| Premium annual | €113.61 | €63.60 | €50.01 |
| Premium monthly, if kept 12 months | €192.12 | €63.60 | €128.52 |

What the tables say:

- **Every paid offer is profitable at typical use, and none loses money at its
  cap.** That is spec §9 doing its job.
- **Annual Premium has almost no headroom at its cap.** The spec gives about
  €9.80 a month for annual Premium "after VAT and fees". That is closer to the
  figure after VAT alone: after card fees and Stripe Tax it is €9.47, and
  with Klarna €9.29, which leaves €0.29–0.47 above the €9.00 cap. That is
  still not a loss, but consider setting `plan:premium` to about €8.50 once
  real costs are known. It is an operator setting and needs no deploy.
- **Monthly subscribers are worth more per month, and annual subscribers pay
  up front.** Few monthly subscribers stay twelve months (section 3.7), which
  is why both options exist. All of these margins are before voice.

### 3.5 Voice: the gap in the caps

Voice is **not yet ledgered or budgeted**
([architecture.md](architecture.md#what-is-not-built)). Its only limits today
are the daily quotas (Plus: 60 transcriptions and 150 model voice lines;
Premium: 200 and 400) and the per-minute rate limits. **The euro caps above do
not cover it.** The product's own speech model (`gpt-audio-mini` through
OpenRouter) has never been priced. The research gives reference points of
**$0.005–0.008 a minute** for transcription ([Deepgram via Cekura][deepgram])
and about **$0.045 a minute** for a commercial synthetic voice
([ElevenLabs][elevenlabs]).

| Case | Assumption | Voice cost per month at the reference prices |
| --- | --- | --- |
| Plus, read-aloud on, typical | 300 replies × ~10 s = 50 min of speech, plus 25 min transcribed | ≈ €2.20 |
| Premium, hands-free, typical | 18 days × 10 min of tutor speech | ≈ €7.30 |
| Premium, at the quota | 400 lines a day, each up to 1,000 characters | Not bounded in euro at all |

At those reference prices, **voice could cost as much as the text tutor
itself**. It would wipe out annual Premium's margin and most of annual Plus's.
The real price may be much lower, because the market is moving fast, but
nothing has measured it yet. So:

1. **Ship B8 (voice in the ledger) before taking real money**, and count voice
   against the same monthly caps.
2. **Do not sell hands-free mode (B7) before B8.** The build order in spec §14
   puts B7 first. Swap the two, or keep B7 unreleased until B8 lands.
3. **Cap hands-free by minutes per day.** Langua caps its call mode at 30
   minutes a day ([Langua review][langua]). Beyond the cap, sell voice-minute
   top-ups rather than stopping the learner.
4. **Measure one real week.** Staff and friends on real keys, then read the
   cost per learner from the ledger.
5. **The browser voice stays free and unlimited** on every plan. A failed or
   refused model voice already falls back to it silently.

### 3.6 Free learners are a cost of acquisition

Every payer carries the free learners who never pay: the number of free
monthly actives per payer, times the average AI cost of one of them.

Here is an illustrative month at **10,000 monthly active learners**, of whom
6% pay. The payers split 45% Plus annual, 30% Plus monthly, 10% Premium
monthly, 10% Premium annual and 5% passes, with free learners at €0.15 each.

| Line | Amount |
| --- | --- |
| Net revenue from 600 payers (after VAT, fees and Stripe Tax) | €4,515 |
| AI cost of payers (465 Plus × €2.30, 135 Premium × €5.30) | −€1,785 |
| AI cost of 9,400 free learners × €0.15 | −€1,410 |
| **Contribution before fixed costs** | **€1,320** (≈ €2.20 per payer) |

How the result moves:

| Share of actives paying | Free cost €0.10 | Free cost €0.15 | Free cost €0.30 |
| --- | --- | --- | --- |
| 4% | €860 | €380 | −€1,060 |
| 6% | €1,790 | €1,320 | **−€90** |
| 9% (Duolingo is about 9% of MAU, [Q2 2026][duo-q2]) | €3,185 | €2,730 | €1,365 |

The lessons:

- **Free cost per active learner is the number that decides the business.**
  At €0.30 a free learner and 6% paying, the business loses money before rent.
  At €0.10–0.15 it makes money. *Our target: at most €0.15 per free monthly
  active, and total free cost at most 25% of net revenue.*
- **If free cost runs high, tighten Free, not the price.** The €1.00 cap, the
  mid tier and the 20-turn quota are all operator settings. Lowering the cap
  to €0.50 affects only the heaviest free learners, and they are the ones
  most likely to convert, so watch conversion when you do it.
- **Paid AI cost is the second lever.** Moving typical Plus from €2.30 to
  €1.50, for example through a cheaper strong-tier model that passes the
  golden set, adds about €370 to the month above.
- **Fixed costs come on top**: hosting, database, email, Steuerberater and
  insurance. Break-even payers = fixed monthly costs ÷ contribution per payer.
  At €2.20 per payer, €1,000 a month of fixed costs needs about 450 payers, or
  roughly 7,500 monthly actives at 6%.

### 3.7 Lifetime value, and what you can afford to spend on acquisition

Lifetime value (LTV) here is the margin a payer brings in over their whole
time as a customer. It uses typical AI cost and the Education benchmarks: 56%
of monthly subscribers renew after the first month, and 24% of annual
subscribers renew after the first year ([RevenueCat renewal rates][rc-renewal]).
After the first renewal we assume a conservative 10% monthly churn. Adapty's
general EdTech figure is 5–7% ([Adapty][adapty], which the research says to
treat with caution).

| Offer | Margin per month | Expected paid months | **LTV (margin)** |
| --- | --- | --- | --- |
| Plus monthly | €5.57 | 1 + 0.56 × 10 = 6.6 | **≈ €37** |
| Plus annual | €2.42 | 12 × 1.24 = 14.9 | **≈ €36** |
| Premium monthly | €10.71 | 6.6 | **≈ €71** |
| Premium annual | €4.17 | 14.9 | **≈ €62** |
| Plus Pass | — | one pass | **≈ €23** per pass |
| Premium Pass | — | one pass | **≈ €25** per pass |

- **The ratio of LTV to acquisition cost (CAC) should be at least 3**, with
  the cost paid back within 12 months. That is the common rule of thumb; the
  research found no language-app-specific figure. On the model
  above, that allows **€12–20 to acquire a paying learner**. At a 3%
  free-to-paid rate, that is **€0.35–0.60 per sign-up**.
- **The conservative check:** RevenueCat's median first-year realised LTV per
  payer in Education is **$22.82** ([RevenueCat Education][rc-edu]). If
  Deutsch Partner retains learners like the median app, acquisition has to
  cost **under about €4 per payer**.
- **Either way, the numbers point to organic growth**: search, communities,
  referral and B2B. Test any paid channel against these figures with a small,
  capped budget before committing more.

### 3.8 Discounts must respect the caps

A discount lowers revenue but not a heavy learner's cost. Before any
promotion code goes live, check that the discounted net per month stays above
the plan's cap, or give the discounted learners a lower per-learner cap. The
per-learner override already exists in `budget_snapshot`.

| Plus annual at | Price | Net per month after VAT, card fee and Stripe Tax | Against the €4.00 cap |
| --- | --- | --- | --- |
| List price | €69.99 | €4.72 | Fine |
| 10% off | €62.99 | €4.25 | Fine |
| 15% off | €59.49 | €4.01 | At the edge |
| 20% off | €55.99 | €3.77 | **Below**: needs an override of about €3.40 |
| 35% off (a student price) | €45.49 | €3.06 | **Below**: needs an override of about €2.75 |
| 50% off | €34.99 | €2.35 | **Below**: needs an override of about €2.10 |

The same applies to monthly plans: 50% off a first Plus month (€4.99) nets
€3.81. **The founding-member offer should therefore be a price lock, not a
deep discount** (section 5).

---

## 4. Competitive position

List prices as the research found them. They vary by country, platform and
promotion. US prices usually exclude sales tax, while Deutsch Partner's
include VAT, so the real gap is wider than the table shows.

| App | Monthly | Annual | Free tier / trial | Where AI and voice sit |
| --- | --- | --- | --- | --- |
| **Duolingo** Super | $16.99 | $119.99 | Free with energy limits and ads. 7-day trial on annual plans only | Video Call moving into Super. Max ($29.99 / $167.99) being phased out ([LanguageAppGuide][duo-price], [Motley Fool][fool]) |
| **Babbel** | $17.99 | $89.99 (one language) | Sample lessons. Students up to 65% off. Gift vouchers | Babbel Speak, full access for subscribers, mobile beta ([Babbel][babbel-press], [DealNews][babbel-deals]) |
| **Busuu** Premium Plus | $13.99 | ~$84 | First 2 conversation lessons | AI conversations in Premium Plus only, mobile only ([LanguageAppGuide][busuu]) |
| **Speak** Premium / Premium Plus | $17.99 / $39.99 | $83.99 / $164.99 | Trial | Plus adds personalised lessons and a study plan ([SpeakShark][speak]) |
| **Praktika** | ~$8 effective | — | Limited free use | Avatars, unlimited speaking, tutor memory ([Praktika][praktika]) |
| **Langua** | $19.99 | $149.99 | 5- or 7-day trial | Call mode capped at 30 min a day ([LanguageAppGuide][langua]) |
| **Talkpal** | $14.99 | $6.25/mo on 24 months | Free basic plan | Chat, roleplay, calls ([iCanLearn][talkpal]) |
| **Memrise** Pro | $24.99 | $61.99 | Free with ads | MemBot AI chat ([Hello Nabu][memrise]) |
| **Lingoda** (human classes) | €8 per group class | €369/mo for 30 classes | Trial | Humans, not AI ([Lingoda][lingoda]) |
| German-only AI tutors | not verified | — | — | Deutsch Mentor, SprechenAI, Univext, Pingo AI ([LanguaTalk][languatalk-de]) |
| **Deutsch Partner Plus** | **€9.99** incl. VAT | **€69.99** | **Free to A1, no card** | Strong-tier tutor and Trainer, model voice |
| **Deutsch Partner Premium** | **€19.99** | **€139.99** | 7-day trial, no card, no auto-conversion | Wider context, hands-free, reports, memory |

**Where Deutsch Partner wins:**

- **Price.** Plus undercuts Duolingo Super, Babbel and Speak Premium on both
  monthly and annual prices, and it includes VAT.
- **German only.** 70 hand-authored mini-levels, a curriculum built for
  English speakers, and scenarios drawn from German life.
- **CEFR-honest.** Levels move only on evidence. The pass mark is arithmetic
  anyone can check, "readiness estimate" is never dressed up as
  certification, and no plan buys a better grade.
- **Generous free tier.** Free runs to A1 with no locked chapters and
  unlimited review. Most competitors lock either content or conversation.
- **Privacy by design.** Conversations are never stored. That is a real
  selling point for expats who are wary of apps.

**Where Deutsch Partner is weaker (be honest about these):**

- It is a web app only, with no app-store presence (and so no store
  commission).
- Voice is push-to-talk. Nothing realtime exists yet.
- There are no streaks, reminders or emails yet, and no brand.
- **Content is thinner than the promise.** 420 words are built, against the
  spec's target of about 2,400 cumulative by B1. Don't market B1 exam
  readiness until that gap closes (section 8).

**Don't compete on** breadth of languages, a gamification arms race, or the
lowest price. Praktika and Talkpal are already cheaper, and a price war is
the opposite of steady growth.

---

## 5. Growth plan

Each stage has a gate. Move to the next stage when its exit criteria are met,
not when the calendar says so. All targets are *our targets*, to be reset
once there is a month of real data.

### Stage 0: before the first euro

- Build B1–B6, B8 and B10 from spec §14, with **voice in the ledger before
  anything is sold**.
- Run the pricing snapshot job for real, and seed the budget rows:
  `plan:free` €1.00, `plan:plus` €4.00, `plan:premium` €9.00, plus a
  `global_daily` ceiling.
- Give the chat route a per-request euro cap, as the Trainer already has.
- Run one week of real use by staff and friends. Read the median and p95 cost
  per turn off the cost dashboard, and redo section 3 with the real figures.
- Complete the legal checklist in section 7.

**Exit:** real costs are known, the caps are live, and a lawyer has reviewed
the order and cancellation flows.

### Stage 1: months 0–3, launch

- **Founding-member code.** A limited cohort, for example the first 300
  payers or the first 90 days, whichever ends first. Founding members keep
  their launch price for as long as their subscription runs, and get
  non-cash thanks: a badge, a say in the roadmap. A discount, if any, should
  be at most 10% on annual Plus (section 3.8). Avoid open-ended lifetime
  deals ([Monetizely][grandfather], [Alex Berman][ltd]). Keeping existing
  customers on their price is also the safer legal route in Germany.
- **SEO and GEO pages, one per German topic.** Today there are three public
  pages and no content section ([seo-and-geo.md](seo-and-geo.md)). Build pages
  from the hand-authored curriculum you already have: der/die/das, the
  dative, the Perfekt, word order, and phrases for the Anmeldung or the
  Ausländerbehörde. Each page ends in "practise this with the tutor", and
  each one feeds `llms.txt` and the structured data so answer engines can
  quote it. Keep every claim CEFR-honest.
- **Communities.** r/German, r/germany, city expat groups, and forums for
  Blue Card holders, au pairs and international students. Take part as the
  founder, say who you are, answer questions properly, and let "free to A1,
  no card" do the selling. No spam.
- **Measure everything in the metrics table below from day one.**

**Targets:** 1,000–2,000 sign-ups; at least 40% of sign-ups clear their first
level within 7 days; free-to-paid at least 2% by day 60; 20–50 payers;
free cost at most €0.15 per monthly active.

### Stage 2: months 3–6, let learners bring learners

- **Referral: give a month, get a month.** The reward is granted when the
  referred learner's first payment clears the 14-day withdrawal window, not at
  sign-up, so it pays for itself and resists abuse. Cap it at 12 reward months
  per referrer per year. A reward month costs at most the plan's cap (typical
  €2.30). Build it on the operator comp grant (spec §5, source 3, not yet
  built), which means editing the spec first.
- **Student discount.** Verify with a university email address or a
  verification service. Babbel offers up to 65% off ([DealNews][babbel-deals]);
  about 35% off with a matching per-learner cap is the sustainable version
  (section 3.8).
- **Gift passes.** A one-off Checkout payment that issues a code, and
  redemption creates a pass. Sell them into Christmas, graduations and the
  "moving to Germany" moment. The buyer's order goes through the same order
  page, withdrawal checkbox and cancellation button as any other order.
- **Retention work on the A2 plateau** (section 6): streaks, the weekly
  progress email, life-admin scenarios.

**Targets:** 150–300 payers; at least 15% of new sign-ups from referral;
monthly churn at most 10% after the second month; contribution positive after
free cost (section 3.6).

### Stage 3: months 6–12, B2B

The same product, sold to organisations whose people need German:

- **Relocation agencies**: a Plus Pass bundled into a relocation package.
- **Employers hiring internationally** (Blue Card hires): German as an
  onboarding benefit.
- **Universities**: international offices, for pre-arrival and first-year
  students.
- **Integration-course schools**: practice between classes. It supplements
  the course and never replaces it.

**Team plans** mean seats, an invoice (Stripe's `send_invoice`), prices quoted
net of VAT with reverse charge for EU businesses (Stripe Tax handles it), and
a small dashboard. Start at about annual Plus net of VAT (€58.82) per seat,
with volume discounts no deeper than section 3.8 allows. **Privacy stays as it is.** An
employer sees seats used and a level band, only with the learner's consent,
and never errors or conversations (conversations are not stored in any case).
Business-to-business contracts are not consumer contracts, but the learner's
data rights still apply. Confirm with a lawyer.

**Targets:** 3–5 paying pilots of 10–50 seats; 400–800 payers in total;
contribution covers fixed costs.

### Stage 4: month 12 onwards, global

- **Local currencies.** Turn on Stripe **Adaptive Pricing**, which showed
  +4.7% conversion in Stripe's A/B test on 1.5M subscription checkouts; the
  customer pays a 2–4% FX fee ([Stripe blog][adaptive-blog],
  [docs][adaptive-docs]). Where a market deserves its own price, add USD, GBP
  or INR as **`currency_options`** on the same Stripe Price. That is
  configuration, not code: `prices:sync` mirrors it into `billing_prices`.
- **Purchasing-power pricing, outside the EU only.** Adaptive Pricing only
  converts currency. PPP needs separate prices per currency or per-country
  coupons. Inside the EU, charging differently by country of residence is
  risky under the Geo-blocking Regulation 2018/302 (unverified; ask a
  lawyer).
- **Local payment methods** such as UPI, Pix and wider iDEAL/Wero use, where
  Stripe supports them for the mode in question.
- **Tax registrations.** Stripe Tax can register and calculate beyond the EU.
  The UK may require VAT registration from the first B2C digital sale by a
  non-UK business (unverified). US sales tax depends on each state's
  thresholds.
- **When a merchant of record starts to pay off.** Stripe Managed Payments
  (live since April 2026, Germany eligible) adds 3.5%, plus 1.5% for
  international cards ([Managed Payments][mp], [pricing][mp-pricing]).
  Paddle is 5% + $0.50 ([Dodo][paddle]). For a mostly-EU business, OSS plus
  Stripe direct costs about half as much. A merchant of record starts to win
  when non-EU sales are spread over many tax jurisdictions and the cost of
  registering and filing in each one exceeds 3.5% of that revenue. Two
  caveats: Managed Payments **excludes products with human involvement**, so
  a human-tutor add-on would have to be sold outside it; and a merchant of
  record becomes the seller, which changes the order and withdrawal flows.
  Take both to the lawyer.

**Targets:** 1,000+ payers; 10–20% of revenue outside the euro area.

### Metrics to watch

| Metric | Definition | Benchmark (source) | *Our target* |
| --- | --- | --- | --- |
| Visit → sign-up | Landing visitors who create an account | None in the research. Set a baseline in month 1 | Improve on the month-1 baseline each quarter |
| Download → trial (reference) | App-store figure, the nearest benchmark | Education median 6.5%, top quartile 13.5% ([RevenueCat Education][rc-edu]) | — |
| **Activation** | First mini-level cleared within 7 days of sign-up | None in the research | ≥ 40% |
| D7 / D30 retention | Active on day 7 / day 30 after sign-up | None in the research | Baseline in month 1, then +2 points a quarter |
| **Free → paid** | Sign-ups who pay within 60 days | Freemium 2.1% at day 35 ([RevenueCat 2026][rc-trends]) | 2–5% |
| Paying share of monthly actives | Payers ÷ monthly actives | Duolingo ≈ 9% ([Q2 2026][duo-q2]) | ≥ 6% |
| Trial → paid | Premium trials followed by any paid order within 30 days | 17–32-day trials convert 42.5%, under 4 days 25.5% (card-up-front trials, [RevenueCat 2026][rc-trends]) | Measure; expect lower with no card |
| First monthly renewal | Monthly payers who pay a second time | Education 56% (IQR 48–66%) ([renewal rates][rc-renewal]) | ≥ 56% |
| Monthly churn after month 2 | Share of monthly payers lost each month | EdTech 5–7% ([Adapty][adapty], treat with caution) | ≤ 10%, aiming for 7% |
| **Annual renewal** | Annual payers still paying after year 1 | Education median **24%** (IQR 17–32%) ([renewal rates][rc-renewal]) | ≥ 24%; plan as if it were 24% |
| Annual cancellations in month 1 | Share of annual cancellations in the first month | ~35% ([RevenueCat 2026][rc-trends]) | Watch the onboarding of annual payers |
| **Free cost per active** | Free AI spend ÷ free monthly actives | — | ≤ €0.15 |
| AI cost ÷ net revenue | All AI spend ÷ revenue after VAT and fees | — | ≤ 40% at launch, falling |
| **LTV : CAC** | Section 3.7 | ≥ 3, payback < 12 months (rule of thumb; no sector source) | ≥ 3 |

These numbers are only worth collecting if someone reads them. Put the bold
ones on one operator page, read them weekly, and change one thing at a time.

---

## 6. Features to add

Effort is rough: **S** is days, **M** is one to three weeks, **L** is a month
or more. Where the repo already holds building blocks, the row says so.

### All plans: habit and acquisition

These are never gated, because they either cost nothing in model spend or
they are the learner's own data.

| Feature | Effort | Why it drives retention or conversion |
| --- | --- | --- |
| **Streaks, daily goal, reminders** | M | Learners with a 7-day streak are 2.4× more likely to come back the next day ([Duolingo][streaks]). Needs an email or notification sender, which nothing has today. No paid streak freezes |
| **Weekly progress email** | M | Visible progress keeps people through the plateau. The data exists (vocabulary, errors, level tallies). The same email sender is needed for the legal confirmations anyway |
| **"12 words due today" reminder** | S, once email exists | Spaced repetition is the strongest habit hook in the product |
| **Placement check at onboarding** | M | Starting at the right level brings the first cleared level sooner, which is the activation metric. The `assessment.onboarding` route exists; it needs a prompt entry |
| **Try before signing up** | M | The first reply before the account is the best proof there is. The `chat_anonymous` rate-limit scope is defined but unused; it needs its own small budget |
| **Level-cleared share card** | S | Word of mouth with a picture. The share-card rendering already exists |
| **Vocabulary export (Anki, CSV)** | S | Trust: "my words are mine". Spec §4 says the learner's own data is never gated |
| **Offline PWA for review** | M–L | Review on the U-Bahn. Review is deterministic, so it can run offline. The manifest exists |
| **Listening stories at level** (browser voice) | M | Comprehension practice at zero model cost. Model voice on Plus |
| **Leben in Deutschland / Einbürgerungstest quiz** | M | A large audience with a deadline, and strong search demand. The quiz is deterministic, so it can be free. Tutor explanations of the questions go on Plus. Check the terms of the official question catalogue |

### Plus: getting through the A2 plateau

| Feature | Effort | Why it drives retention or conversion |
| --- | --- | --- |
| **Life-admin scenario packs**: Anmeldung, Ausländerbehörde, doctor, landlord, job interview | M | The reason many learners learn at all. A real-life win keeps them through the plateau. The scenarios table exists. Roleplay dialogues are chat sessions on Plus; comprehension stays free |
| **Writing correction for emails and letters** | M | Immediate real-world value (the landlord, the Behörde), and preparation for B1 Schreiben. Needs a new task in the routing table and a prompt catalogue entry |
| **Shadowing and dictation** | M | Daily speaking and listening habit. Dictation is graded by string comparison (free); shadowing uses transcription |
| **Grammar clinic for a persistent error** | S–M | "Your dative errors fell 40%" is progress a learner can see. Built on `learner_errors` as a Trainer agenda item |
| **Pause instead of cancel**, offered in `/billing` | S | Keeps learners who travel or take a break. Stripe supports pausing. **Never on the cancellation page**, where it is unlawful |
| **Referral: give a month, get a month** | M | The cheapest paid acquisition (section 5, stage 2) |

### Premium: reasons to step up

| Feature | Effort | Why it drives retention or conversion |
| --- | --- | --- |
| **Hands-free conversation mode** (B7) | L | The headline Premium experience. Needs streaming speech, voice-activity detection and barge-in. **Only after B8**, with a daily minute cap |
| **Milestone and B1 readiness reports** | M | Proof of progress at 15→16, 35→36 and late B1: the natural Premium moments. `assessment.milestone` is routed (reasoning tier, rare) but has no prompt entry. Always a *readiness estimate* |
| **Long-term tutor memory** | M | "It knows me" is the strongest reason to stay. `extraction.memory` and `learner_memories` exist, uncalled. Needs a consent decision; transcripts stay unstored |
| **Goethe / telc B1 exam prep**: Schreiben and Sprechen mock tests with feedback against the marking criteria | L | An exam date is the best motivation there is, and it sells Premium Passes. A *readiness estimate*, never certification. Wait until the B1 content gap closes |
| **Pronunciation feedback** | L | Speaking confidence is what learners say they lack. Needs phoneme-level scoring from a separate provider: a new task, tier and ledger row, and a break from the one-key setup |
| **Voice in the Trainer** | M | Specified for Premium. Makes the Trainer a speaking coach |
| **Voice-minute top-ups** | S–M, after B8 | Heavy voice users pay for what they use instead of hitting a wall. One-off Checkout payments that need the same early-start checkbox |

### Family, gifts and business

| Feature | Effort | Why it drives retention or conversion |
| --- | --- | --- |
| **Gift passes** | S–M | Seasonal revenue, and every gift brings in a new learner |
| **Family plan** | M | Couples and families move together. Duolingo Family is $143.99 a year for six ([LanguageAppGuide][duo-price]). Needs a household model with a cap for each member |
| **Team / B2B seats and dashboard** | L | Opens relocation agencies, employers and universities. Needs an organisation and seat model with RLS, separate from the ops app |
| **Human tutor add-on** | L | The top of the ladder. Babbel sells live classes and Lingoda charges €8 a class. **Must be sold outside Stripe Managed Payments**, which excludes products with human involvement ([eligibility][mp-elig]). Tutors' contracts and marketplace law are questions for the lawyer |

### Things not to build

- **Lifetime deals.** A two-year customer is worth more than a one-off
  payment, and AI cost never stops.
- **Paid streak freezes, gems or loot mechanics.** They sell anxiety, not
  German.
- **Ads on Free.** They conflict with the privacy design, and they are not
  worth the revenue at this scale.
- **Selling levels, badges or "fast-track" passes.**
- **Conversation history by default.** Not storing transcripts is a design
  decision (guardrails S16). If it is ever offered, make it an explicit
  opt-in.
- **Retention offers on the cancellation page, or trials that convert
  silently.** Both are unlawful in Germany.

---

## 7. Legal and tax must-dos before taking real money

**This is a checklist to take to a lawyer and a Steuerberater, not legal
advice. Confirm every item with them before the live Stripe key is
configured.** It combines spec §11 with the research.

### Before any paid order (spec B5)

- [ ] **Prices shown including VAT**, with "incl. VAT" beside them. An annual
  price shown per month also shows the annual total (PAngV).
- [ ] **The order page.** Directly above the button: the main features, the
  total price including VAT, the billing interval, that the plan renews until
  cancelled, and how to cancel.
- [ ] **The order button** reads "Order with obligation to pay". "Abonnieren"
  and "Weiter zur Zahlung" are not valid (OLG Düsseldorf, 08.02.2024,
  20 UKl 4/23; [IT-Recht Kanzlei][itrecht-button], [§312j BGB][bgb312j]). A
  wrong button makes the contract **void**. *Ask:* does the English label
  satisfy §312j(3) on an English-language site, or should German-locale
  visitors see "Zahlungspflichtig bestellen"? And does Stripe's own
  "Subscribe" button on the following page, with our custom text above it,
  muddy the order?
- [ ] **The early-start checkbox**, unticked by default. An AI tutor is a
  digital service (§356(4) BGB), so the 14-day withdrawal right does not end
  on first use. The learner asks for an immediate start and acknowledges that
  withdrawing means paying for the days used (§357a(2)). Record it with a
  timestamp and the terms version ([Heuking][heuking]).
- [ ] **Withdrawal instructions and the model form.** If they are missing,
  the consumer owes nothing, even for service already delivered (CJEU C-97/22).
- [ ] **The trial stays card-free and never auto-converts**, so it places no
  paid order.

### Before the live key (spec B10)

- [ ] **Cancellation button (§312k BGB).** "Cancel contracts here", in every
  page footer, working **without signing in**. It leads to a page with only
  the form and a "Cancel now" button, and **no retention offer**
  (BGH 16.07.2026, I ZR 200/25). It covers **passes as well as
  subscriptions** (BGH 22.05.2025, I ZR 161/24). Confirm immediately in text
  form ([Plutte][plutte], [WBS][wbs], [Noerr][noerr-cancel]).
- [ ] **Withdrawal button (§356a BGB, in force since 19.06.2026).**
  "Withdraw from contract", in two steps, for the whole 14 days, with a
  text-form confirmation. It may sit behind sign-in
  ([Noerr][noerr-withdraw], [Bitkom][bitkom]).
- [ ] **An email sender.** Both buttons and the withdrawal instructions need
  immediate text-form confirmation, and the product has no sender today.
- [ ] **Annual renewal (§309 Nr. 9 BGB).** The first year is fixed. After
  that the plan continues but can be cancelled at any time with at most one
  month's notice, refunding unused whole months. It never renews into a
  second fixed year ([Verbraucherzentrale][vz], [IHK Köln][ihk-koeln]).
- [ ] **Impressum (§5 DDG):** name, a postal address for service (not a PO
  box), email plus a second fast contact channel, and a VAT ID if you have one.
  Fines go up to €50k ([IHK Chemnitz][ihk-chemnitz]).
- [ ] **Terms (AGB) and privacy policy.** Voice recordings are personal data.
  You need data-processing agreements with OpenRouter, Stripe and any speech
  provider, and a legal basis for transfers outside the EU.
- [ ] **EU AI Act Art. 50 (from 02.08.2026).** The tutor says it is an AI,
  and synthetic speech carries a machine-readable mark. A proposal would delay
  the marking duty to 02.12.2026 for systems already on the market
  ([Cooley][cooley], [Sidley][sidley]).
- [ ] **Account deletion cancels an active subscription first** (spec §10,
  not built). Learner **data export and self-deletion** are not built either,
  and a paid product needs both under GDPR.

### Tax

- [ ] **Kleinunternehmer or not.** Since 2025 the limits are €25k in the
  prior year and €100k in the current year ([Pandotax][pandotax]). *Ask:*
  does a Kleinunternehmer still owe non-deductible §13b reverse-charge VAT on
  foreign services such as OpenRouter (unverified)?
- [ ] **OSS registration.** Once cross-border EU B2C sales exceed €10k a
  year, charge each customer's national rate and file one OSS return.
  Filing yourself through the BZSt is free (quarterly); through Stripe's
  partners it costs about $145 a filing ([Stripe OSS guide][stripe-oss],
  [Stripe Tax pricing][stripe-tax]).
- [ ] **Stripe Tax:** registrations entered and `STRIPE_AUTOMATIC_TAX` on.
  Check that Stripe's invoices carry everything a German invoice needs.
- [ ] **Stripe Tax or a merchant of record**: a decision for the Steuerberater
  once non-EU sales begin (section 5, stage 4).

### Coming soon

- [ ] **The Digital Fairness Act.** A proposal is expected by the end of 2026,
  aimed at hard cancellation, silent trial conversion and auto-renewal
  ([European Parliament][dfa]). Build trial-end and renewal reminders, and
  keep cancelling as easy as signing up. The design already does most of
  this.

---

## 8. Risks, and how the design contains them

| Risk | What would happen | How the design contains it | What to watch |
| --- | --- | --- | --- |
| **AI cost spike**: a heavy learner, a bug or abuse | One account burns euros | Per-minute rate limits, per-24-hour quotas, a monthly euro cap per plan, degrading at 90% and refusing at 100%, and a global daily ceiling. The Trainer has a €0.05 bound per request | **None of this exists until B6 ships and the budget rows are seeded.** Pre-flight cost projection returns 0 until the pricing snapshot job runs, so one oversized call is not stopped in advance. The chat route has no per-request euro cap yet (stage 0) |
| **Voice outside the caps** | Model voice costs as much as the text tutor, uncounted | Daily voice quotas, rate limits, audio length bounds, and the free browser voice as fallback | B8 before taking money, and B7 after B8 (section 3.5) |
| **Calendar months against billing months** | Caps reset on the calendar month, but a monthly plan bills mid-month. One billing period can touch two capped months: up to €8 for Plus and €18 for Premium against €7.87 and €16.01 of net revenue | Rare, and it averages out over any subscription that lasts more than a month | If the ledger shows it happening, align a learner's cap with their billing period |
| **Trial abuse** | New accounts each take a 7-day Premium trial and use up to €9 of AI | One trial per learner. Daily quotas | Give trialling learners a per-learner cap of about €2 |
| **Free costs outgrow revenue** | At €0.30 per free active learner and 6% paying, the business loses money (section 3.6) | Free runs on the mid tier with a €1.00 cap, and the operator can change both without a deploy | Free cost per active, weekly |
| **Model price changes** | Margins move overnight | Costs are computed from `model_pricing_snapshots` with a `fetched_at` stamp (stale after 7 days), never from code. The registry can change a tier's model through environment variables, and each tier has fallbacks | Prices are falling across the market (Duolingo's AI call is now under a cent, [TIKR][tikr]). When they fall, keep the price and bank the margin before cutting prices |
| **The annual renewal cliff** | 76% of annual payers are gone after year 1 (Education median) | Plan as if each annual sale is one year of revenue. Passes sell goals without a renewal. After year 1, German law makes the plan cancellable monthly anyway | Renewal rate. Send an honest progress summary before the renewal date, not a discount |
| **Front-loaded monthly churn** | 44% of monthly payers do not renew after month 1 | Activation, streaks and the weekly email (section 6). Offer annual Plus at the A1 milestone, when commitment is highest | First-renewal rate |
| **Klarna fees** | 7.2% of a monthly Plus charge | Dynamic payment methods: switch Klarna off for subscriptions in the Dashboard, no deploy. Keep it for passes and annual plans | Payment method mix, monthly |
| **Discounts undercut the caps** | Heavy discounted learners are served at a loss | The rule in section 3.8, with per-learner cap overrides | Every new promotion code |
| **Legal button rules** | A void contract, refunds, or a warning letter (Abmahnung) from a competitor or consumer association | The order is placed on our own page with a compliant button before Checkout; cancellation and withdrawal buttons; checkbox evidence stored in `billing_checkouts` | Lawyer review before B10, and again when the Digital Fairness Act lands |
| **Refunds from withdrawal** | Learners withdraw inside 14 days | Pro-rata refunds with recorded early-start consent. Correct instructions (without them, the learner owes nothing) | Withdrawal rate by channel. A spike means a promise that isn't being kept |
| **Content depth at B1** | Selling "B1 readiness" with 420 of the ~2,400 target words built | CEFR-honest copy. Readiness estimates, never certification | Don't launch exam prep or market B1 until the content gap closes |
| **Free tier quality is unmeasured** | Free learners judge the product by the mid-tier tutor, and tell their friends | Spec §3: the conversation golden set compares Free and Plus before launch | If mid is noticeably worse, Free's word of mouth suffers. Fix the model before tightening the caps |
| **Disputes and failed debits** | €20 per card dispute, €3.50 per failed SEPA debit | Clear statement descriptors, Radar, and Smart Retries (8 attempts in 2 weeks by default, [Stripe][smart-retries]) | Dispute rate |
| **One model provider** | An OpenRouter outage or price change hits every call | Same-tier fallbacks in the registry | Provider concentration, as part of the stage-4 review |

---

## Sources

Every external figure is linked where it is used. They come from market
research dated 2026-09-25 (Stripe fees, German and EU consumer law,
competitor pricing, subscription benchmarks). Repository sources:
[billing-and-plans-spec.md](../.claude/docs/billing-and-plans-spec.md) ·
[model-routing-and-cost-control.md](../.claude/docs/model-routing-and-cost-control.md) ·
[architecture.md](architecture.md) · [operations.md](operations.md) ·
[product-flow.md](product-flow.md) · [seo-and-geo.md](seo-and-geo.md).

[stripe-pricing]: https://stripe.com/en-de/pricing
[stripe-lpm]: https://stripe.com/pricing/local-payment-methods
[stripe-klarna]: https://docs.stripe.com/payments/klarna
[stripe-tax]: https://support.stripe.com/questions/understanding-stripe-tax-pricing
[stripe-oss]: https://stripe.com/guides/introduction-to-eu-vat-and-european-vat-oss
[adaptive-blog]: https://stripe.com/blog/adaptive-pricing-for-subscriptions
[adaptive-docs]: https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing
[mp]: https://docs.stripe.com/payments/managed-payments
[mp-elig]: https://docs.stripe.com/payments/managed-payments/eligibility
[mp-pricing]: https://support.stripe.com/questions/managed-payments-pricing
[smart-retries]: https://docs.stripe.com/billing/revenue-recovery/smart-retries
[paddle]: https://dodopayments.com/blogs/paddle-fees-explained
[bgb312j]: https://www.gesetze-im-internet.de/bgb/__312j.html
[itrecht-button]: https://www.it-recht-kanzlei.de/facebook-bestellbutton-abonnieren-weiter-zur-zahlung-unzulaessig.html
[heuking]: https://www.heuking.de/de/news-events/newsletter-fachbeitraege/artikel/vorsicht-bei-widerrufsbelehrungen-bei-digitalen-inhalten-und-dienstleistungen.html
[noerr-withdraw]: https://www.noerr.com/de/insights/umsetzungsgesetz-zum-widerrufsbutton-veroeffentlicht
[bitkom]: https://www.bitkom.org/Bitkom/Publikationen/Umsetzung-des-Widerrufsbuttons
[plutte]: https://www.ra-plutte.de/kuendigung-online-abo-alles-wichtige-312k-bgb/
[wbs]: https://www.wbs.legal/allgemein/bgh-urteil-zum-kuendigungsbutton-keine-ablenkungsmanoever-auf-der-bestaetigungsseite-87491/
[noerr-cancel]: https://www.noerr.com/de/insights/kuendigungsbutton-im-onlinevertrieb-neue-rechtsprechung-des-bgh
[vz]: https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/gesetz-fuer-fairere-vertraege-mehr-schutz-bei-kosten-und-laufzeiten-55274
[ihk-koeln]: https://www.ihk.de/koeln/hauptnavigation/recht-steuern/faire-verbrauchervertraege-5329466
[ihk-chemnitz]: https://www.ihk.de/chemnitz/recht-und-steuern/rechtsinformationen/internetrecht/pflichtangaben-im-internet-die-impressumspflicht-4401580
[cooley]: https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026
[sidley]: https://datamatters.sidley.com/2026/06/24/eu-ai-act-transparency-obligations-preparing-for-compliance-by-2-august-2026/
[dfa]: https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act
[pandotax]: https://pandotax.de/ecommerce/eu-kleinunternehmerregelung-onlinehaendler-2025/
[duo-price]: https://languageappguide.com/pricing/duolingo-cost/
[fool]: https://www.fool.com/investing/2026/09/14/the-green-owl-is-ending-duolingos-own-cash-cow/
[tikr]: https://www.tikr.com/blog/duolingo-cut-its-priciest-ai-feature-to-under-a-penny-a-call-heres-what-that-does-to-margins
[duo-q2]: https://investors.duolingo.com/news-releases/news-release-details/duolingo-reports-second-quarter-2026-results
[streaks]: https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/
[babbel-press]: https://www.babbel.com/press/en-us/releases/babbel-speak
[babbel-deals]: https://www.dealnews.com/features/babbel/plan-pricing/
[busuu]: https://languageappguide.com/app-reviews/busuu-review/
[speak]: https://speakshark.com/blog/speak-app-pricing-per-month-2026
[praktika]: https://intercom.help/praktika-ai/en/articles/11684862-what-subscription-plans-does-praktika-offer-and-what-is-included-in-the-paid-plan
[langua]: https://languageappguide.com/app-reviews/langua-review/
[talkpal]: https://www.icanlearn.com/jumpspeak-vs-talkpal/
[memrise]: https://www.hellonabu.com/blog/en/is-memrise-free/
[lingoda]: https://www.lingoda.com/en/pricing/
[languatalk-de]: https://languatalk.com/blog/german/how-to-learn-german-with-ai/
[rc-trends]: https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026
[rc-edu]: https://www.revenuecat.com/state-of-subscription-apps-2026-education
[rc-renewal]: https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category
[adapty]: https://adapty.io/blog/education-app-subscription-benchmarks/
[grandfather]: https://www.getmonetizely.com/articles/grandfathering-strategies-managing-legacy-pricing-gracefully-in-the-saas-world
[ltd]: https://alexberman.com/saas-lifetime-deal
[deepgram]: https://www.cekura.ai/blogs/deepgram-pricing
[elevenlabs]: https://elevenlabs.io/pricing/api
