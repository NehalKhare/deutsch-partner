# Deutsch Partner

An AI German-conversation tutor for English speakers, from absolute beginner to
B1. Next.js App Router, TypeScript, Supabase and OpenRouter.

You talk to it in German. It replies at your level, corrects you in the way your
level can use, and keeps track of what you know — seventy mini-levels from a
first *hallo* to holding an opinion. When four in five of your recent messages
come back error-free, it moves you up on its own; say *weiter* (or press the
button) to move on early.

What you say is never stored. A conversation lives in your browser and dies
with the tab; the database keeps only what the practice meant — your mistakes,
your vocabulary, and a per-level score.

## Documentation

| Document | What it answers |
| --- | --- |
| [Product flow](docs/product-flow.md) | What a learner does, and what happens when they do it |
| [Architecture](docs/architecture.md) | How the code is laid out and why the boundaries are where they are |
| [How the pieces work](docs/topics.md) | Plain-language explanations of RAG, prompting, vector search, Next.js and the rest |
| [Operations](docs/operations.md) | Environment, ingestion, cost, and what to check when something breaks |

The specifications this was built against are in
[`.claude/docs/`](.claude/docs/); the four above describe what was actually
built, including what was not.

## Getting started

```bash
cp .env.example .env.local   # then fill in the Supabase values
pnpm install
pnpm dev
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server on port 3000 |
| `pnpm verify` | Typecheck, lint, the full test suite, then a production build |
| `pnpm test:unit` | Unit and component tests (jsdom) |
| `pnpm test:db` | Schema and RLS tests against real Postgres, in-process via PGlite |
| `pnpm test:e2e` | Playwright, against a production build on port 3100 |
| `pnpm db:push` | Applies pending migrations to the linked Supabase project |
| `pnpm db:seed` | Re-applies the generated curriculum and vocabulary seeds |
| `pnpm db:advisors` | Supabase security and performance linters |
| `pnpm ingest` | Embeds the knowledge corpus. Safe to re-run; does nothing if nothing changed |
| `pnpm ingest --dry-run` | Reports what would be ingested, without a provider or a key |
| `pnpm scenarios:ingest` | Embeds the scenario corpus (Python, via uv). Same idempotence contract, same `--dry-run` |
| `pnpm scenarios:eval` | Evaluates scenario retrieval: hit@5, then ragas metrics via a judge model |
| `pnpm scenarios:test` | The Python parser and ingestion-plan tests |

## The curriculum

Three files are the single source of truth. [`learning/curriculum.ts`](learning/curriculum.ts)
holds the seventy mini-levels — theme, topic, target words, grammar, functions.
[`learning/lexicon.ts`](learning/lexicon.ts) holds one dictionary entry for each
of the 420 target words. [`learning/grammar-seeds.ts`](learning/grammar-seeds.ts)
holds the 86 grammar patterns, each with the mistakes the tutor quotes when it
corrects someone. Goals, thresholds, frequency bands and difficulty are derived
from those, so nothing can drift out of step with its own content.

The database needs the same rows — a learner's state points at a mini-level,
their vocabulary progress at a word, their errors at a pattern — so all three
seed migrations are generated rather than maintained beside them:

```bash
pnpm curriculum:generate   # rewrites the three generated seed migrations
pnpm db:seed               # re-applies them to the linked project
```

Tests compare each committed migration against a fresh render, so editing one
without the other fails rather than drifting quietly.

`db:seed` exists because a migration runs once. The seeds are declarative and
idempotent, so a fresh database gets them from `db push`, while one that already
applied an earlier version gets the update from `db:seed`.

## A fixture learner

```bash
pnpm dummy:user
```

Creates a confirmed account on the project `.env.local` points at, signs in with
the publishable key, completes onboarding through the same RPC the form calls,
and prints the credentials. The password is generated on each run unless
`DEV_SEED_PASSWORD` is set; nothing usable is committed. The address must sit on
a reserved domain, so a fixture account can never mail a real person.

With `DEV_SEED_EMAIL` and `DEV_SEED_PASSWORD` set, `pnpm test:e2e` also runs the
fixture sign-in spec; without them it skips.

This creates a real account on a real project. Delete it before the project is
reachable by anyone but you.

## Three things that shape the codebase

**A tutor that costs more per learner than it earns is not a product.** Every
model call is routed to the cheapest tier that can do the job, capped in tokens
before it is sent, and written to a euro ledger. A typical learner turn costs
about €0.0064. See [operations](docs/operations.md#cost).

**The model is not the curriculum.** Mini-level progression, mastery scores,
review scheduling and recommendations are pure functions over the learner's own
record — cheaper, reproducible, and explainable without asking a model to
justify itself.

**Model output is never trusted.** Every structured reply is validated, salvaged
where that is safe, and discarded where it is not. The safe answer when an
evaluation cannot be read is to write nothing.

## Scenarios & Comprehensions

A second corpus of fifty hand-authored practice items under **/scenarios**,
searchable in a learner's own words ("I want to practice ordering food at a
restaurant"). Each item is one of exactly two types: a **dialogue** — a
German script with English translations, practised as an AI roleplay in the
chat — or a **comprehension** — a German passage (reading text, telephone
menu or train announcement) answered as a quiz, graded by a string check in
the browser at no model cost. Search embeds the query through the gateway
(ledgered, budgeted, cached) and matches by vector similarity via the
`search_scenarios` database function, filterable to dialogues or
comprehensions. Every result carries a source citation — the dataset document
and item it was parsed from — through the API response onto the card. The
corpus is parsed and embedded by the Python tooling in
[`scripts/scenarios/`](scripts/scenarios/), which also carries the ragas
retrieval evaluation.

## Status

Every phase of the build specification is implemented: 2905 tests across 158
files (plus 31 Python tests), typecheck, lint and a production build clean,
and 28 migrations for the linked project.

**No chat model has ever been called.** Every test drives a fake transport; the
real transports are written and tested against a fake `fetch`. The embedding
pipelines have run for real: both corpora — knowledge and scenarios — are
embedded on the linked project, through OpenRouter, which now carries every
model call the text product makes (speech alone still goes direct to OpenAI).
[Architecture](docs/architecture.md#what-is-not-built)
lists what else is deliberately not built.
