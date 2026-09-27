You are the AI architect and cost/reliability engineer for Deutsch Partner.

This document is authoritative for: which model runs which task, how many tokens
any call may consume, and how spend is capped. It overrides any conflicting
model or token guidance in the other documents in this directory.

==================================================
1. CORE PRINCIPLE
==================================================

One model for everything is a defect, not a default.

Deutsch Partner performs many distinct AI operations per learner turn. Only one
of them is a quality-critical open-ended conversation. The rest are narrow,
schema-constrained, or deterministic.

Rules:

Route by task, never by convenience.

Every model call has a hard output ceiling. No exceptions.

Every model call has a hard input budget enforced BEFORE the request is sent.

Every model call records actual cost.

Deterministic logic beats a cheap model. A cheap model beats a strong model.
Reach up a tier only with evidence from evaluation, not intuition.

Cost is a product constraint, not an afterthought. A tutor that costs more per
learner than it earns is not a product.

==================================================
2. PROVIDER TOPOLOGY
==================================================

This resolves the conflict between AGENTS.md and build-spec.md.

OpenRouter is the gateway for ALL chat/completion traffic.

OpenRouter does NOT provide embeddings, speech-to-text, or text-to-speech.
Those go direct to their own providers behind our own interfaces.

Layering:

  LangGraph                 <- orchestration, node sequencing, state
      |
      v
  ModelGateway              <- OUR code. The only thing allowed to call an LLM.
      |
      +--> OpenRouter       <- all chat/completion, all tiers
      +--> EmbeddingProvider   <- direct (e.g. OpenAI embeddings)
      +--> SpeechToTextProvider <- direct
      +--> TextToSpeechProvider <- direct

Hard rule:

No file outside packages/gateway/src/ may import an SDK client, construct a fetch to
a model endpoint, or call LangChain's model classes directly. The one non-model call
the gateway makes is a GET of the provider's price list, for the pricing snapshot job. LangGraph nodes call
ModelGateway. A CI grep test enforces this (see section 12).

Reason: ceilings, budgets, accounting, redaction, and retries cannot be
guaranteed if any module can open its own connection to a model.

LangSmith remains the tracing backend. Tracing is observability, not a call path.

==================================================
3. MODEL TIERS
==================================================

Define tiers, not model names, in application code. Model names live in one
registry file and in environment configuration. Code refers to tiers.

TIER: reasoning
  Purpose: hardest reasoning only. Curriculum generation, milestone assessment
           scoring, disputed level adjudication.
  Frequency: rare, offline or milestone-only. Never on the chat hot path.

TIER: strong
  Purpose: the German conversation turn. The learner-facing voice.
  Frequency: once per learner message.
  This is the ONLY tier permitted on the streaming hot path, with two
  exceptions, both downward: budget degradation (S9), and the free plan's
  mid-tier tutor (billing-and-plans-spec.md S3).

TIER: mid
  Purpose: structured extraction that needs real language understanding.
           Learning evaluation, onboarding diagnostic scoring.
  Frequency: once per learner message (async, off the response path).

TIER: cheap
  Purpose: narrow, schema-bound, short-output work. Classification, error
           extraction, memory extraction, summarization, tagging.
  Frequency: high volume.

TIER: nano
  Purpose: single-label classification with a tiny fixed output.
           Routing, safety screen, language detection.
  Frequency: highest volume.

TIER: embedding
  Purpose: vector embeddings for ingestion and retrieval.

TIER: stt
  Purpose: speech-to-text.

TIER: tts
  Purpose: text-to-speech.

Model registry requirements:

Each tier maps to: a primary model id, an ordered fallback list, a hard output
ceiling, a hard input ceiling, and a context-window figure.

Model ids MUST be configurable per environment. Do NOT hardcode a model id in
business logic. Do NOT hardcode prices anywhere (see section 8).

Verify any candidate model id against the live OpenRouter model list before
adopting it. Model availability and pricing change; a stale hardcoded
assumption is a production incident.

==================================================
4. TASK -> TIER ROUTING TABLE
==================================================

This table is normative. A task not in this table does not get to call a model
until it is added here with a ceiling.

TASK                            TIER         WHY
------------------------------  -----------  ------------------------------------
conversation.turn               strong       Learner-facing quality. The product.
conversation.repair             strong       Only when the strong turn failed
                                             validation. Max one retry.
evaluation.learner_message      mid          Structured, Zod-validated, needs
                                             genuine grammar understanding.
assessment.milestone            reasoning    A1/A2/B1 milestone scoring only.
                                             Rare. Not mini-level checks.
assessment.mini_level_check     mid          Frequent, narrower than milestone.
assessment.onboarding           mid          One-time per learner.
extraction.errors               cheap        Pull error instances out of an
                                             already-produced evaluation.
extraction.memory               cheap        Candidate long-term memories.
                                             Batched, not per-message.
extraction.vocabulary_usage     deterministic + cheap
                                             Lemmatize and match against the
                                             vocabulary table first. Model only
                                             for unmatched tokens.
summarization.thread            cheap        Rolling thread summary.
classification.intent           nano         vocab / grammar / conversation /
                                             culture / web. Single label.
classification.topic            nano         Single label from a closed set.
classification.language         deterministic + nano
                                             Try a heuristic detector first.
classification.safety_screen    nano         Cheap pre-filter. NOT a security
                                             boundary (see guardrails doc S31).
recommendation.ranking          deterministic
                                             Scoring function over learner state.
                                             See section 5.
recommendation.tiebreak         cheap        Only when deterministic scores tie
                                             within a threshold. Optional.
retrieval.query_rewrite         cheap        Only if evaluation proves it helps.
                                             Off by default.
retrieval.rerank                cheap or dedicated reranker
                                             Off by default. Phase 12+.
ingestion.metadata_tagging      cheap        Offline batch. Never at request time.
ingestion.embedding             embedding    Direct provider.
retrieval.embedding             embedding    Direct provider. Cache aggressively.
voice.transcribe                stt          Direct provider.
voice.synthesize                tts          Direct provider.

Plan variants. conversation.turn, conversation.repair and trainer.session may
carry a byPlan entry (billing-and-plans-spec.md S3). A plan entry may only move
the tier down the chat ladder from the row above and may only narrow its
ceilings; the row is the maximum any plan reaches. The plan is resolved on the
server from entitlement rows and is never a caller's input, so "callers cannot
override the tier for a task" (S12) still holds. Every other task, and in
particular everything that writes learner state or grades German, has one
route for every plan.

Explicitly NOT model calls:

mini-level progression        -> pure functions over learner state
mastery score calculation     -> pure functions
review scheduling             -> spaced-repetition algorithm
level advancement gating      -> rules over multi-dimensional evidence
difficulty band selection     -> configuration + learner state
behavior policy selection     -> configuration lookup by effective level

If any of the above is implemented as a model call, that is a bug.

==================================================
5. RECOMMENDATION RANKING IS DETERMINISTIC
==================================================

Recommendation ranking must be a scoring function, not a prompt.

Score inputs (all already in the database):

  review_due_weight        * overdue review items
  weakness_weight          * unresolved recurring errors
  level_fit_weight         * distance from effective level within the 80/20 band
  interest_weight          * overlap with declared interests
  recency_penalty          * how recently this activity type was recommended
  diversity_bonus          * activity type not used in the last N recommendations

Deterministic ranking is cheaper, faster, testable, reproducible, and
explainable to the learner. All of those matter more here than nuance.

A cheap-tier tiebreak call is permitted ONLY when the top candidates score
within a configured epsilon. It must be feature-flagged and default off.

==================================================
6. HARD TOKEN CEILINGS
==================================================

Every call goes through a validated call spec. The spec type makes ceilings
non-optional:

  ModelCallSpec {
    task:              TaskId              // must exist in the routing table
    tier:              Tier                // derived from task, not caller-set
    maxOutputTokens:   number              // REQUIRED, no default
    maxInputTokens:    number              // REQUIRED, no default
    timeoutMs:         number              // REQUIRED
    schema?:           ZodSchema           // required for all non-conversation tasks
  }

A call spec without maxOutputTokens must fail Zod validation. There is no
fallback default, because a silent default is how a runaway bill happens.

Enforcement is layered. All four layers are required:

LAYER 1 — Pre-flight input budget
  Count tokens on the fully assembled prompt before dispatch.
  If over maxInputTokens: shed context deterministically in this order
    1. oldest recent-messages beyond the minimum window
    2. lowest-scoring retrieved chunks
    3. lowest-salience memories
  Never shed: system policy, learner state block, current user message.
  If still over after shedding: reject the call with a typed error. Do not send.

LAYER 2 — Provider ceiling
  Always send the provider's max output token parameter set to maxOutputTokens.
  Never omit it.

LAYER 3 — Stream guard
  While streaming, count emitted tokens. Abort the stream at maxOutputTokens
  even if the provider ignores the parameter. Persist what was received and mark
  the message truncated.

LAYER 4 — Budget gate
  Before dispatch, check the EUR budget counters (section 9). Over budget means
  the call does not happen.

Starting ceilings. These are defaults to be tuned with real traces, not
constants to treat as sacred. Tune with evidence.

TASK                            MAX INPUT   MAX OUTPUT
------------------------------  ----------  ----------
conversation.turn (A1)              4000         300
conversation.turn (A2)              5000         450
conversation.turn (B1)              6000         700
conversation.turn premium (A1)      5000         400
conversation.turn premium (A2)      6500         600
conversation.turn premium (B1)      8000        1000
conversation.repair                 6000         700
evaluation.learner_message          3000         800
assessment.milestone                8000        1500
assessment.mini_level_check         3000         600
assessment.onboarding               3000         800
extraction.errors                   2000         400
extraction.memory                   3000         300
extraction.vocabulary_usage         1500         300
summarization.thread                6000         400
classification.intent                800          20
classification.topic                 800          20
classification.language              400          10
classification.safety_screen        1000          10
recommendation.tiebreak             1500         150
retrieval.query_rewrite              600         120
ingestion.metadata_tagging          4000         400

Note the shape: the classification tasks cap output in the tens of tokens. A
single-label classifier that can emit 4096 tokens is a misconfiguration.

Per-turn aggregate ceiling:

A single learner message must not exceed a configured total token budget across
ALL calls it triggers (conversation + evaluation + extraction + classification).
Enforce this as a per-request accumulator on the request context. Exceeding it
degrades gracefully: drop the optional calls (memory extraction, tiebreak,
query rewrite) before dropping the required ones.

==================================================
7. CONTEXT BUDGET DISCIPLINE
==================================================

Token ceilings are only enforceable if context assembly is bounded by
construction. Each prompt section gets a fixed budget:

  system policy + behavior policy      bounded, versioned, measured in tests
  learner state block                  compact structured summary, NOT raw rows
  thread summary                       one summary, capped
  recent messages                      last N turns, N by tier
  retrieved knowledge                  top-K chunks, K and per-chunk cap
  learner memories                     top-M by salience, M capped
  current user message                 capped by input validation

Rules:

Never send full conversation history. Ever. Use summary plus a window.

Never send raw database rows into a prompt. Send a rendered, compact projection.

Retrieval returns top-K where K is small (start at 4-6) and each chunk is
truncated to a per-chunk cap.

The prompt builder must expose a dry-run mode that returns the assembled prompt
and its token count without dispatching. Tests assert budgets against it.

Cost reduction that requires no quality tradeoff, do these first:

  - Cache embeddings by content hash. Never re-embed unchanged text.
  - Cache classification results by normalized input hash with a TTL.
  - Batch memory extraction across a thread instead of per message.
  - Run evaluation asynchronously after the response streams, not before.
  - Use provider prompt caching for the stable system/policy prefix where the
    routed provider supports it. Order the prompt stable-prefix-first so the
    cacheable portion is contiguous.
  - Skip evaluation entirely for trivial messages (greetings, one-word replies)
    detected deterministically.

==================================================
8. USAGE AND COST ACCOUNTING
==================================================

Never estimate cost from a hardcoded price table. Prices change and a stale
table produces confidently wrong dashboards.

Sources of truth:

  1. Request usage accounting from OpenRouter, requested per call, which returns
     the actual charged cost for that generation.
  2. The OpenRouter models endpoint for per-token pricing, fetched on a schedule
     and cached in the database with a fetched_at timestamp. Used only for
     pre-flight estimation and for providers that do not return cost inline.
  3. Direct providers (embeddings, STT, TTS) return token or duration usage;
     price those from the cached pricing table for that provider.

Every model call writes exactly one ledger row, on success AND on failure.
A failed call that consumed tokens still cost money.

The ModelGateway is responsible for writing the ledger row. Callers cannot skip
accounting because callers never touch the provider.

Recorded per call, minimum:

  request_id, trace_id, span_id
  user_id_hash            (pseudonymous; see guardrails doc S18)
  thread_id, message_id   (nullable)
  task, tier
  provider, model_id, model_id_resolved   (what OpenRouter actually routed to)
  input_tokens, output_tokens
  reasoning_tokens        (nullable)
  cached_input_tokens     (nullable)
  max_output_tokens       (the ceiling that applied)
  truncated               (boolean; layer 3 fired)
  latency_ms, first_token_ms
  status                  ok | error | timeout | budget_denied | ceiling_denied
  error_code              (nullable)
  cost_usd                (native currency from provider, exact)
  fx_rate_eur_per_usd     (the rate applied, snapshotted)
  cost_eur                (derived at write time, never recomputed later)
  created_at

Never write conversation content into the ledger.

EUR handling:

Providers bill in USD. The product reports in EUR.

  - Maintain an fx_rates table: currency pair, rate, rate_date, source,
    fetched_at.
  - Snapshot the rate daily from one named source.
  - Convert at write time and STORE cost_eur. Historical rows are immutable.
    Never restate past spend when the rate moves.
  - If no rate for today is available, carry forward the most recent rate and
    flag the row as fx_stale. Never block a call on an FX lookup.
  - The dashboard shows the rate and date used, because a euro figure derived
    from an unstated rate is not auditable.

==================================================
9. BUDGETS AND FAIL-CLOSED BEHAVIOR
==================================================

Budgets are enforced in EUR at four scopes, all configurable:

  per_request      max EUR a single learner turn may cost
  per_user_daily   max EUR one learner may cost in a rolling 24h
  per_user_monthly max EUR one learner may cost in a calendar month
  global_daily     max EUR the whole application may cost in a day

Enforcement:

Check budget counters before dispatch. Counters are maintained incrementally on
ledger write, not computed by scanning the ledger on every request.

Thresholds per scope:

  warn at 70%     structured log at WARN, dashboard indicator
  degrade at 90%  drop optional calls; downgrade conversation.turn from strong
                  to mid; reduce K in retrieval; shorten output ceilings
  deny at 100%    fail closed

Fail closed means: no model call. Return a clear, non-technical message to the
learner. Never silently downgrade to an unbudgeted path, and never let a budget
failure bypass authorization or corrupt thread state.

Degraded mode must be visible: log it, surface it on the dashboard, and mark
affected messages so quality regressions are explainable later.

Global daily denial is an incident. It should page, not just log.

Free-tier and anonymous users get their own, much smaller, budget scope. Ties
into the rate limiting requirements in the guardrails doc S7.

Cost abuse is an attack surface. A user who can trigger unbounded expensive
model calls has found a financial denial-of-service. Treat repeated budget
denials as a security audit event (guardrails doc S24).

==================================================
10. FALLBACK AND RETRY
==================================================

Fallback must never silently escalate cost.

  - Fallback within a tier first (alternate model, same tier).
  - Cross-tier fallback UPWARD requires an explicit per-task allowlist and is
    recorded on the ledger row as an escalation.
  - Cross-tier fallback DOWNWARD is always permitted and is the preferred
    degradation under budget pressure.
  - Max one repair retry for schema-validation failures. A second failure falls
    back to the safe path, it does not retry again.
  - Retries are separate ledger rows. Never overwrite.
  - Timeouts count against budget if tokens were produced.

Structured-output failure handling follows guardrails doc S12: validate, retry
once, repair if safe, fall back, log. Never execute unvalidated model output.

==================================================
11. EVALUATION BEFORE DOWNGRADE
==================================================

Do not pick tiers by guessing. Build a small golden set per task and measure.

For each model-calling task, maintain:

  - a fixture set of representative inputs
  - an assertion of acceptable output (schema validity, label accuracy, or
    rubric score for open-ended text)
  - a recorded cost and latency per tier

Promote a task to a cheaper tier when the cheap tier passes the golden set.
Promote upward only when the golden set demonstrates the cheaper tier fails.

Track per task: schema-validation failure rate, repair rate, fallback rate.
A cheap tier that fails schema validation 30% of the time and repairs on a
strong model is more expensive than starting strong.

==================================================
12. REQUIRED TESTS
==================================================

TDD applies here as everywhere. These tests are part of the definition of done.

Routing:
  - each task in the routing table resolves to its declared tier
  - an unknown task id is rejected
  - callers cannot override the tier for a task

Ceilings:
  - a call spec missing maxOutputTokens fails validation
  - a call spec missing maxInputTokens fails validation
  - an over-budget prompt triggers deterministic shedding in the documented order
  - shedding never removes system policy, learner state, or the user message
  - a prompt still over budget after shedding is rejected, not sent
  - the stream guard aborts at the ceiling when a mock provider overruns
  - a truncated message is persisted and flagged, not lost

Aggregate:
  - a single turn exceeding the per-turn budget drops optional calls first
  - required calls are never dropped silently

Accounting:
  - every successful call writes exactly one ledger row
  - every failed call writes exactly one ledger row
  - no ledger row contains message content
  - cost_eur is computed from the stored fx rate, not recomputed on read
  - a missing FX rate carries forward and flags fx_stale

Budgets:
  - at 90% the degrade path activates and is logged
  - at 100% the call is denied and no provider request is made
  - a denied call does not corrupt thread state
  - a denied call still writes a ledger row with status budget_denied
  - per-user budget exhaustion does not affect another user

Architecture:
  - CI grep test: no import of a provider SDK or model client outside
    packages/gateway/src/ (the routing table itself is packages/domain/src/tasks.ts)
  - CI grep test: no hardcoded model id outside the model registry
  - CI grep test: no hardcoded price literal anywhere

==================================================
13. RELATIONSHIP TO OTHER DOCS
==================================================

business-objective.md S13 sets the default embedding to a 1536-dimension model
behind an abstraction. That remains correct, with the correction that embeddings
do NOT go through OpenRouter. They go direct to the embedding provider through
EmbeddingProvider.

business-objective.md S17 requires separating conversation generation from
learning evaluation. This document assigns them different tiers, which is the
main cost lever in the whole application. Keep them separate.

security-observability-guardrails.md S19 lists AI logging fields. Extend that
list with: task, tier, model_id_resolved, cost_usd, cost_eur,
fx_rate_eur_per_usd, max_output_tokens, truncated, budget_scope_hit.

build-spec.md gains Phase 10.5 (ModelGateway) and Phase 17.5 (cost dashboard).
The ModelGateway must exist BEFORE the first real model call in Phase 15,
otherwise ceilings and accounting get retrofitted, which in practice means
never.
