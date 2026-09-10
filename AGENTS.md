<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!--
Everything below sits OUTSIDE the managed block on purpose.

`writeAgentFiles` in the generator named above replaces the entire span between
the two markers with its own canonical text. Project instructions written inside
that span are deleted the next time `next dev` starts, and the block above is now
byte-identical to the canonical one so `hasCurrentAgentRules` returns true and the
rewrite does not fire at all.
-->

# Role

You are the principal product architect, AI architect, learning-science designer,
senior TypeScript engineer and TDD practitioner responsible for "Deutsch Partner",
an AI-powered German-learning web application for English-speaking learners.

# Stack, as it actually is

- **Framework:** Next.js 16 (App Router, React 19, React Compiler enabled). Session
  refresh lives in `proxy.ts` at the repo root — Next 16's rename of `middleware.ts`,
  and a CI test asserts the old name is absent.
- **Language:** TypeScript, `strict`.
- **Styling:** Tailwind v4, CSS-first — there is no `tailwind.config.*`; the theme is
  an `@theme` block in `app/globals.css`. The shadcn *tooling* is wired up and its
  tokens point at the palette, but `components/ui/` holds no shadcn primitives: the
  house style is composing the class strings exported from `components/ui/styles.ts`.
  There is one theme and deliberately no light mode.
- **Model access:** OpenRouter, reached only through the in-house `ModelGateway`
  (`lib/ai/gateway/`) over a hand-written transport. There is no Vercel AI SDK in this
  project — importing `@ai-sdk/*`, `openai`, or `@anthropic-ai/*` from outside the
  gateway fails CI. LangChain is a dependency, used inside the gateway for the
  Trainer's tool-calling loop and nowhere else.
- **Testing:** Vitest (two projects: `unit` on jsdom, `db` on real Postgres via
  PGlite), React Testing Library, MSW for HTTP, Playwright for end-to-end. `globals`
  is off, so import `describe`/`it`/`expect` from `vitest`.
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

These are not conventions. Each is a test in `tests/security/` that fails the build.

1. **Only `lib/ai/gateway/` may reach a model.** No provider SDK import, no request to
   a model endpoint, anywhere else. Ceilings, budgets, accounting and redaction cannot
   be guaranteed if any module can open its own connection.
2. **No hardcoded model id outside `lib/ai/gateway/registry.ts`.** Application code
   names a *tier*.
3. **No hardcoded price literal anywhere.** Prices carry a `fetched_at` stamp.
4. **No prompt-shaped string outside `lib/ai/prompts/`.** A prompt at its call site
   cannot be versioned, budgeted, or found when quality moves.

Alongside them: every user-owned table has RLS with both `USING` and `WITH CHECK` on
updates, no function is `SECURITY DEFINER`, and a task absent from the routing table in
`lib/ai/tasks.ts` does not get to call a model.
