# @dp/ops

The operator product: a Next.js 16 app on its own origin, behind a password and
an authenticator code. It shows euro spend by task and model, the learner
directory, learner feedback, and the AI Product Ops board and its runs.

It records work and reads results; it never does the work. There is no model
key and no repository token here — when an operator starts a run, this app
writes a job to `ops_jobs` and `apps/worker` picks it up.

## What it is built with, and why

It is a website built with Next.js, a React framework. We chose it because it
shows pages that are already filled in with the latest numbers, and it keeps
the database code on the server, out of the browser. It is written in
TypeScript, which catches mistakes before the code runs, and styled with
Tailwind. The styles come from the same shared set the learner app uses, with
a blue palette swapped in so no one confuses the two apps. Accounts and data
live in Supabase, a hosted Postgres database with sign-in built in. Supabase
also provides the authenticator-app second factor, and its row-level rules
decide who can see what even if a bug gets past the app. Zod checks every row
that comes back from the database, so a surprise shows up as an error instead
of a wrong number on the dashboard. The app makes no AI calls itself. That
keeps it cheap and simple, and because it has no AI key, a break-in could not
run up a model bill.

## Running it

```bash
cp .env.example .env.local        # from this directory, then fill it in
pnpm dev                          # from the root: all three deployables
pnpm dev:ops                      # from the root: this app alone, on :3001
```

To sign in you need an account in the same Supabase project the learner app
uses, with its id in `OPERATOR_USER_IDS`. After the password, a session goes to
`/login/mfa` for an authenticator code; `/mfa/enrol` is where a new operator
registers one. Until a second factor is presented, every other page redirects
back to that step.

## Who gets in

Every page, action and route handler calls `requireOperator`
(`lib/auth/require-operator.ts`), which asks three questions and fails closed:
is there a session, is its account on the allowlist, and has it presented a
second factor. A signed-in account that is not on the list is signed out of
this origin and gets a 404, not a 403, so the refusal cannot be used to find
out who is an operator. Every admission is written to the audit trail against
the operator's pseudonym, never their id.

`proxy.ts` refreshes the session and redirects to the right step. That is a
convenience; `requireOperator` and the database are the boundary.

## What is where

| Path | What it holds |
| --- | --- |
| `app/(ops)/costs/` | AI spend: the overview, `invocations` (and one invocation), `budgets`, `pricing` |
| `app/(ops)/learners/` | The learner directory, one learner, and a per-learner `export` route |
| `app/(ops)/feedback/` | What learners said about the trainer |
| `app/(ops)/product/` | The Product Ops board, one proposal, and `runs` |
| `app/(ops)/notifications/` | The operators' one inbox: runs waiting on a decision, failed jobs, the budget closing, notices. The bell in the header reads the same rows |
| `app/login/`, `app/mfa/` | Password sign-in, the second-factor step, and enrolment |
| `app/api/` | `health`, the server-sent event stream for a run (`runs/[runId]/events`), and the bell's poll (`notifications`) |
| `lib/` | Auth, the queries behind each dashboard, env and the Supabase clients |
| `components/` | The app's React components |

The colours come from `packages/ui/src/theme-ops.css`, which overrides the
learner palette's values under the same role names. It is imported after
`theme.css` in `app/globals.css`, and the order matters.

## Environment

| Variable | Why |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | The same project as the learner app |
| `LOG_PSEUDONYM_SALT` | Must match the other two deployables. Unset means no operator gets in, because an admission must be recorded against someone |
| `OPERATOR_USER_IDS` | Comma-separated account ids. Unset means nobody |
| `OPS_COOKIE_NAME` | Defaults to `dp-ops-auth`, so the two apps can share `localhost` without overwriting each other's session |

A CI test fails the build if `.env.example` here ever declares a model key or a
repository token.

## Commands

Run from this directory, or from the root with `pnpm --filter @dp/ops <script>`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | `next dev` on :3001 |
| `pnpm start` | `next start` on :3001 |
| `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` | What `pnpm verify` at the root runs for this app |

## Further reading

- [Architecture](../../docs/architecture.md#the-operator-workflow) — the operator workflow end to end
- [Product ops agents](../../docs/product-ops-agents.md) — the graph, gates and agents behind the board
- [Operations](../../docs/operations.md#cost) — how spend is recorded and bounded
