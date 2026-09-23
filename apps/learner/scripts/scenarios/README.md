# Scenario corpus tooling

Python tooling for the **Scenarios & Comprehensions** feature: parse the
dataset, classify and embed it, and evaluate retrieval quality. Everything
here is offline batch tooling; at request time the application embeds queries
through its own gateway (`lib/ai/gateway/`) and searches through the
`search_scenarios` database function.

Requires [uv](https://docs.astral.sh/uv/) and Python 3.11/3.12 (ragas does
not support 3.14 yet; uv provisions the right interpreter automatically).

## The pipeline

| Step | Command (from the repository root) |
| --- | --- |
| Parse + report, no keys needed | `uv run --project scripts/scenarios scripts/scenarios/ingest_scenarios.py --dry-run` |
| Embed + upsert into Supabase | `uv run --project scripts/scenarios scripts/scenarios/ingest_scenarios.py` |
| Retrieval sanity check (hit@5) | `uv run --project scripts/scenarios --extra eval scripts/scenarios/eval_ragas.py --retrieval-only` |
| Full ragas evaluation | `uv run --project scripts/scenarios --extra eval scripts/scenarios/eval_ragas.py` |
| Parser + plan tests | `uv run --project scripts/scenarios --extra dev -m pytest scripts/scenarios/tests` |

Environment comes from the repository's `.env.local` / `.env`:
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `OPENROUTER_API_KEY` —
embeddings, answer generation and the judge all ride OpenRouter, so one key
covers every model call here. `EMBEDDING_MODEL` (default
`openai/text-embedding-3-small`, 1536 dimensions — the registry's embedding
tier) and `RAGAS_JUDGE_MODEL` (default `openai/gpt-4o-mini`) can be
overridden.

## What the parser produces

The two files under `dataset/` are the Markdown extraction of the scenario
PDFs, and their structure is rigid enough to parse deterministically —
classification is structural, not statistical:

| Source | Type | Kind | Count |
| --- | --- | --- | --- |
| `Conversational_German_15_Dialogue_Stories.md` | `dialogue` | dialogue | 15 (5×A1, 5×A2, 5×B2) |
| `German_Listening_and_Comprehension_Practice.md` Part II | `comprehension` | telephone | 5 (A1) |
| — Part IV | `comprehension` | announcement | 15 (5×A1, 5×A2, 5×B2) |
| — Part V | `comprehension` | reading | 15 (5×A1, 5×A2, 5×B2) |

Parts I, III and VI of the comprehension file are learner strategy prose, not
scenario items, and are skipped.

**Chunking strategy: one item, one embedding.** Every scenario is a small,
self-contained unit (≈250–750 tokens, far under the 8191-token embedding
ceiling), and splitting one across chunks would let a query match half a
scenario. The embedded text carries every search signal: both titles, type,
kind, level, description, the full German and English body, and the
vocabulary glosses — the same text is stored in `scenarios.embedding_text` so
retrieval quality can be audited later.

## Idempotence

Same contract as `pnpm ingest`: an item is keyed by its slug and carries a
`content_hash` of everything stored and embedded. Unchanged hash → skipped
before any provider call; slug no longer produced → pruned; re-running over
an unchanged dataset costs nothing and writes nothing. `--force` re-embeds
everything (needed after changing `EMBEDDING_MODEL` — vectors from different
models are not comparable).

## Evaluation

`evalset.json` holds two golden suites — dialogue retrieval and comprehension
retrieval — each a natural-language learner query with the slugs a correct
retrieval should surface and a reference answer. `eval_ragas.py` runs each
query through the same path the API takes (embed → `search_scenarios` with
the suite's type filter) and reports:

- **hit@5** per suite, deterministic, no judge model — the regression canary;
- **context_precision, context_recall, faithfulness, answer_relevancy** via
  ragas, using an OpenRouter-served judge and a generated grounded answer.
  Each retrieved context is prefixed with its citation (`Source: <document>,
  item <n>`) and the generator is instructed to cite it, mirroring how the
  product's own responses carry their sources.

The report lands in `scripts/scenarios/eval_report.json` (gitignored). The
script exits non-zero when a golden case misses, so it can gate CI.

## Deliberate limitation

This offline tooling calls the embedding provider directly, so its calls are
not written to the application's usage ledger or euro budgets — the same
stated exception the repository already makes for offline corpus work. Every
run prints its token usage so the cost is visible where it is incurred.
Request-time query embedding *is* ledgered, budgeted and cached, because it
goes through the gateway.
