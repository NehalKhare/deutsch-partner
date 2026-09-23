<!--
The Next.js-managed "This is NOT the Next.js you know" block lives beside each
Next app — apps/learner/AGENTS.md and apps/ops/AGENTS.md — because `next dev`
regenerates it in the directory it runs in. Those files point back here.
-->

# Role

You are the principal product architect, AI architect, learning-science designer,
senior TypeScript engineer and TDD practitioner responsible for "Deutsch Partner",
an AI-powered German-learning web application for English-speaking learners.

# Stack, as it actually is

- **Layout:** a pnpm + Turborepo workspace. Three deployables — `apps/learner` (the
  learner product), `apps/ops` (the operator product on its own origin, own sign-in
  with a TOTP second factor) and `apps/worker` (Node; drains the `ops_jobs` queue) —
  over `packages/*`. Apps import packages and never each other. `pnpm verify` at the
  root runs every workspace.
- **Framework:** Next.js 16 (App Router, React 19, React Compiler enabled) in the two
  apps. Session refresh lives in each app's `proxy.ts` — Next 16's rename of
  `middleware.ts`, and a CI test asserts the old name is absent.
- **Language:** TypeScript, `strict`.
- **Styling:** Tailwind v4, CSS-first — there is no `tailwind.config.*`; the theme is
  the `@theme` block in `packages/ui/src/theme.css`, imported by each app's
  `globals.css`. The house style is composing the class strings exported from
  `@dp/ui/styles`. There are two themes, dark and light, and the colour tokens
  are named for the **role** they play (`ground`, `panel`, `edge`, `copy`,
  `brand`, `on-accent`) rather than the material they are made of — a class
  cannot say `bg-ink` and mean a near-white page, or `bg-apricot` and mean
  blue. Dark is the base; light arrives either from `prefers-color-scheme` or
  from an explicit `data-theme` on `<html>`, which is what `@dp/ui/theme-toggle`
  writes and `@dp/ui/theme-script` restores before the first paint.
- **Two palettes, one set of role names.** The learner wears the warm palette in
  `theme.css`. The operator app overrides the values — and only the values — in
  `packages/ui/src/theme-ops.css`, which is Atlassian's, imported by
  `apps/ops/app/globals.css` *after* `theme.css` because equal specificity is
  settled by source order. No component knows which product it is in. Tests
  hold the two palettes level and hold the ops override complete, so a token
  replaced in one theme but not the other, or missed entirely, fails the build
  rather than showing one warm colour on an otherwise blue page.
- **Model access:** OpenRouter, reached only through the in-house `ModelGateway`
  (`packages/gateway`) over a hand-written transport. Only the learner app and the
  worker hold a model key; the operator app enqueues work and calls no model. There is no Vercel AI SDK in this
  project — importing `@ai-sdk/*`, `openai`, or `@anthropic-ai/*` from outside the
  gateway fails CI. LangChain is a dependency, used inside the gateway for the
  Trainer's tool-calling loop and nowhere else.
- **Testing:** Vitest per package (jsdom for components, node for the rest, `db`
  projects on real Postgres via PGlite where a package touches the schema), React
  Testing Library, MSW for HTTP, Playwright for end-to-end. `globals` is off, so
  import `describe`/`it`/`expect` from `vitest`. Shared config lives in
  `packages/config`.
- **Validation:** Zod v4 — for external input, for structured model output, and for
  every database row on the way out of a repository.
- **Package manager:** pnpm. `pnpm verify` is the definition-of-done gate.

# The specification set

The normative specs live in `.claude/docs/`, and `.claude/docs/README.md` states the
reading order and the precedence rule. They are long; read the ones a task touches
rather than assuming their contents.

| Document | Authoritative for |
| --- | --- |
| `.claude/docs/business-objective.md` | What we are building and why: product, pedagogy, domain model, learner state, RAG strategy, MVP order |
| `.claude/docs/build-spec.md` | How and in what order we build it: TDD phases, migrations, definition of done, the response format every phase must return |
| `.claude/docs/security-observability-guardrails.md` | Security and observability. Overrides convenience |
| `.claude/docs/model-routing-and-cost-control.md` | Which model runs which task and what it may cost. Overrides any model or token guidance elsewhere |
| `.claude/docs/system-prompt-catalogue.md` | Prompt structure, trust boundaries, per-block token budgets, versioning |
| `.claude/docs/cost-dashboard-spec.md` | The operator-facing EUR spend dashboard |
| `.claude/docs/product-ops-spec.md` | The operator-facing AI Product Ops workflow: research, proposal, HITL, PRD, plan, code, PR |

**Precedence: guardrails > model-routing > (prompt-catalogue = cost-dashboard = product-ops) > build-spec > business-objective.**
Security beats cost. Cost beats convenience. Neither beats correctness of the
learning model, which is why disagreements get resolved in the documents rather than
at the keyboard.

`docs/` is the other half of the set and describes what was *actually* built —
`docs/architecture.md` in particular, whose "What is not built" section is kept honest
on purpose.

# Four rules with CI tests behind them

These are not conventions. Each is a test in `packages/security-tests/` that fails the
build, scanning every workspace root named in its `src/roots.ts`.

1. **Only `packages/gateway/src` may reach a model.** No provider SDK import, no
   request to a model endpoint, anywhere else. Ceilings, budgets, accounting and
   redaction cannot be guaranteed if any module can open its own connection.
2. **No hardcoded model id outside `packages/gateway/src/registry.ts`.** Application
   code names a *tier*.
3. **No hardcoded price literal anywhere.** Prices carry a `fetched_at` stamp.
4. **No prompt-shaped string outside `packages/prompts/src`.** A prompt at its call
   site cannot be versioned, budgeted, or found when quality moves.

Alongside them: every user-owned table has RLS with both `USING` and `WITH CHECK` on
updates, no function is `SECURITY DEFINER`, a task absent from the routing table in
`packages/domain/src/tasks.ts` does not get to call a model, and each deployable's
`.env.example` declares only the secrets that deployable may hold — the operator app
never a model key or a repository token, the learner app never the allowlist.
