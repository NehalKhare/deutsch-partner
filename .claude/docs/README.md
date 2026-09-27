Deutsch Partner — design document set.

Read in this order. Where documents disagree, the precedence below wins.

1. business-objective.md
   Product, pedagogy, domain model, learner state, RAG strategy, MVP order.
   Authoritative for: what we are building and why.

2. build-spec.md
   TDD phases, stack, migrations, definition of done, response format.
   Authoritative for: how and in what order we build it.

3. security-observability-guardrails.md
   RLS, authorization, prompt injection, logging, metrics, audit, CI gates.
   Authoritative for: security and observability. Overrides convenience.

4. model-routing-and-cost-control.md
   Provider topology, model tiers, task routing table, hard token ceilings,
   usage accounting, EUR budgets, fail-closed behavior.
   Authoritative for: which model runs which task and what it may cost.
   Overrides any model or token guidance in the other documents.

5. system-prompt-catalogue.md
   Prompt catalogue structure, composition, trust boundaries, per-block token
   budgets, versioning.
   Authoritative for: prompt structure. Implements build-spec.md Phase 10.

6. cost-dashboard-spec.md
   Operator-facing EUR spend dashboard: schema, aggregation, views, alerts.
   Implements build-spec.md Phase 17.5. Depends on document 4.

7. product-ops-spec.md
   Operator-facing AI Product Ops workflow: stages, idempotency, the two human
   gates, and what the coding agent may touch.
   Authoritative for: the product-ops workflow. Depends on documents 3 and 4.

8. billing-and-plans-spec.md
   Plans, entitlements, plan-dependent routing, Stripe payments, the webhook,
   and the consumer-law obligations of selling a subscription in Germany.
   Authoritative for: what each plan includes and how money is taken.
   Depends on documents 3 and 4.

Precedence: 3 > 4 > 5 = 6 = 7 = 8 > 2 > 1.
Security beats cost. Cost beats convenience. Neither beats correctness of the
learning model, which is why disagreements get resolved in the documents rather
than at the keyboard.

CONFIGURATION NOTE

.env.example currently pins a single OPENROUTER_MODEL. That is a one-model-for-
everything configuration and contradicts document 4. It must be replaced during
Phase 10.5 with per-tier configuration:

  OPENROUTER_MODEL_REASONING
  OPENROUTER_MODEL_STRONG
  OPENROUTER_MODEL_MID
  OPENROUTER_MODEL_CHEAP
  OPENROUTER_MODEL_NANO
  EMBEDDING_PROVIDER / EMBEDDING_MODEL / EMBEDDING_DIMENSIONS
  STT_PROVIDER / STT_MODEL
  TTS_PROVIDER / TTS_MODEL
  BUDGET_GLOBAL_DAILY_EUR
  BUDGET_USER_DAILY_EUR
  BUDGET_USER_MONTHLY_EUR
  BUDGET_REQUEST_EUR
  FX_RATE_SOURCE

plus fallback lists per tier. Verify every model id against the live OpenRouter
model list before adopting it; do not carry a model id forward on assumption.
