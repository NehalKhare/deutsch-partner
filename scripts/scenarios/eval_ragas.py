"""Evaluate scenario retrieval with ragas.

Run from the repository root, after `pnpm db:push` and an ingestion run:

    uv run --project scripts/scenarios --extra eval scripts/scenarios/eval_ragas.py [--retrieval-only] [--suite dialogue|comprehension]

Two test suites from ``evalset.json`` — dialogue retrieval and comprehension
retrieval — are run against the same search path the API uses: the query is
embedded with the corpus's embedding model and handed to the
``search_scenarios`` database function with the suite's type filter.

Two layers of measurement:

* **Deterministic** (needs only the Supabase and OpenAI keys): hit@k — did a
  scenario the golden set names for this query appear in the top k? Cheap,
  stable, and the first thing to look at when retrieval regresses.
* **ragas** (adds an LLM judge via OpenRouter): context_precision,
  context_recall, faithfulness and answer_relevancy per suite. The judged
  "answer" is generated from the retrieved contexts by a small model, which
  is the standard ragas arrangement for scoring a retrieval pipeline that
  has no fixed generator of its own.

``--retrieval-only`` skips the ragas layer entirely. Everything model-shaped —
query embedding, answer generation, the judge — rides OpenRouter, so the
environment is just ``NEXT_PUBLIC_SUPABASE_URL``, ``SUPABASE_SECRET_KEY`` and
``OPENROUTER_API_KEY``, with ``EMBEDDING_MODEL`` and ``RAGAS_JUDGE_MODEL`` as
overrides. The report is written to ``scripts/scenarios/eval_report.json``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx

from ingest_scenarios import (
    DEFAULT_EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    EMBEDDINGS_URL,
    REPO_ROOT,
    embedding_key,
    load_env_files,
    require,
    vector_literal,
)

HERE = Path(__file__).resolve().parent
EVALSET = HERE / "evalset.json"
REPORT = HERE / "eval_report.json"

TOP_K = 5
OPENROUTER_URL = "https://openrouter.ai/api/v1"
DEFAULT_JUDGE_MODEL = "openai/gpt-4o-mini"


# ---------------------------------------------------------------------------
# Retrieval: the same path the API takes
# ---------------------------------------------------------------------------


def embed_query(client: httpx.Client, api_key: str, model: str, text: str) -> list[float]:
    response = client.post(
        EMBEDDINGS_URL,
        headers={"authorization": f"Bearer {api_key}"},
        json={"model": model, "input": [text], "dimensions": EMBEDDING_DIMENSIONS},
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()["data"][0]["embedding"]


def search(
    client: httpx.Client,
    rest_url: str,
    embedding: list[float],
    scenario_type: str,
) -> list[dict]:
    response = client.post(
        f"{rest_url}/rpc/search_scenarios",
        json={
            "p_embedding": vector_literal(embedding),
            "p_types": [scenario_type],
            "p_levels": None,
            "p_limit": TOP_K,
        },
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()


def contexts_for(client: httpx.Client, rest_url: str, slugs: list[str]) -> dict[str, str]:
    """The exact text each retrieved scenario was embedded as, with its
    citation prepended so a generated answer has a source to name."""
    if not slugs:
        return {}
    quoted = ",".join(f'"{slug}"' for slug in slugs)
    response = client.get(
        f"{rest_url}/scenarios",
        params={
            "select": "slug,embedding_text,source,item_index",
            "slug": f"in.({quoted})",
        },
    )
    response.raise_for_status()
    return {
        row["slug"]: (
            f"Source: {row['source']}, item {row['item_index'] + 1}\n\n"
            f"{row['embedding_text']}"
        )
        for row in response.json()
    }


def run_retrieval(
    suites: dict[str, list[dict]],
    supabase: httpx.Client,
    openrouter: httpx.Client,
    rest_url: str,
    provider_key: str,
    embedding_model: str,
) -> dict[str, list[dict]]:
    """Retrieve for every case; returns per-suite rows with hits and contexts."""
    results: dict[str, list[dict]] = {}
    for suite_name, cases in suites.items():
        rows = []
        for case in cases:
            vector = embed_query(openrouter, provider_key, embedding_model, case["question"])
            found = search(supabase, rest_url, vector, suite_name)
            found_slugs = [row["slug"] for row in found]
            texts = contexts_for(supabase, rest_url, found_slugs)
            rows.append(
                {
                    "question": case["question"],
                    "expected_slugs": case["expected_slugs"],
                    "reference": case["reference"],
                    "retrieved_slugs": found_slugs,
                    "contexts": [texts[slug] for slug in found_slugs if slug in texts],
                    "hit": any(slug in case["expected_slugs"] for slug in found_slugs),
                    "first_hit_rank": next(
                        (
                            rank + 1
                            for rank, slug in enumerate(found_slugs)
                            if slug in case["expected_slugs"]
                        ),
                        None,
                    ),
                }
            )
        results[suite_name] = rows
    return results


# ---------------------------------------------------------------------------
# ragas
# ---------------------------------------------------------------------------


def generate_answer(
    client: httpx.Client,
    api_key: str,
    model: str,
    question: str,
    contexts: list[str],
) -> str:
    """A grounded answer from the retrieved contexts, for the judged metrics."""
    joined = "\n\n---\n\n".join(contexts)
    response = client.post(
        f"{OPENROUTER_URL}/chat/completions",
        headers={"authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "max_tokens": 300,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Answer the learner's request using only the provided "
                        "scenario context. Recommend the matching scenario, "
                        "say briefly what it practises, and cite the scenario "
                        "title and the source line given with the context."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Request: {question}\n\nContext:\n{joined}",
                },
            ],
        },
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def run_ragas(
    retrieval: dict[str, list[dict]],
    env: dict[str, str],
    openrouter_key: str,
    embed_key: str,
    embedding_model: str,
) -> dict[str, dict[str, float]]:
    # Imported lazily: the eval extra is heavy and --retrieval-only should not
    # need it installed at all.
    from datasets import Dataset
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings
    from ragas import evaluate
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import (
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )

    judge_model = env.get("RAGAS_JUDGE_MODEL", "").strip() or DEFAULT_JUDGE_MODEL
    judge = LangchainLLMWrapper(
        ChatOpenAI(
            model=judge_model,
            base_url=OPENROUTER_URL,
            api_key=openrouter_key,
            temperature=0,
        ),
    )
    embeddings = LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(
            model=embedding_model,
            base_url=OPENROUTER_URL,
            api_key=embed_key,
            dimensions=EMBEDDING_DIMENSIONS,
            # OpenRouter's embeddings endpoint wants plain string input, not
            # the client's default pre-tokenized form.
            check_embedding_ctx_length=False,
        ),
    )

    scores: dict[str, dict[str, float]] = {}
    with httpx.Client() as generator:
        for suite_name, rows in retrieval.items():
            answered = [
                {
                    "question": row["question"],
                    "contexts": row["contexts"],
                    "answer": generate_answer(
                        generator,
                        openrouter_key,
                        judge_model,
                        row["question"],
                        row["contexts"],
                    ),
                    "ground_truth": row["reference"],
                }
                for row in rows
                if row["contexts"]
            ]
            if not answered:
                print(f"  {suite_name}: nothing retrieved, ragas skipped")
                continue

            outcome = evaluate(
                Dataset.from_list(answered),
                metrics=[context_precision, context_recall, faithfulness, answer_relevancy],
                llm=judge,
                embeddings=embeddings,
            )
            frame = outcome.to_pandas()
            scores[suite_name] = {
                metric: round(float(frame[metric].mean()), 4)
                for metric in (
                    "context_precision",
                    "context_recall",
                    "faithfulness",
                    "answer_relevancy",
                )
                if metric in frame
            }
    return scores


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument(
        "--retrieval-only",
        action="store_true",
        help="hit@k only; skip the LLM-judged ragas metrics",
    )
    arguments.add_argument(
        "--suite",
        choices=["dialogue", "comprehension"],
        help="run one suite instead of both",
    )
    options = arguments.parse_args()

    suites: dict[str, list[dict]] = json.loads(EVALSET.read_text(encoding="utf-8"))["suites"]
    if options.suite:
        suites = {options.suite: suites[options.suite]}

    env = load_env_files(REPO_ROOT)
    supabase_url = require(env, "NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
    secret_key = require(env, "SUPABASE_SECRET_KEY")
    provider_key = embedding_key(env)
    embedding_model = env.get("EMBEDDING_MODEL", "").strip() or DEFAULT_EMBEDDING_MODEL
    rest_url = f"{supabase_url}/rest/v1"

    with httpx.Client(
        headers={"apikey": secret_key, "authorization": f"Bearer {secret_key}"},
        timeout=30.0,
    ) as supabase, httpx.Client() as openrouter:
        retrieval = run_retrieval(
            suites, supabase, openrouter, rest_url, provider_key, embedding_model,
        )

    print()
    for suite_name, rows in retrieval.items():
        hits = sum(1 for row in rows if row["hit"])
        print(f"  {suite_name}: hit@{TOP_K} = {hits}/{len(rows)}")
        for row in rows:
            marker = f"rank {row['first_hit_rank']}" if row["hit"] else "MISS"
            print(f"    [{marker:>6}] {row['question']}")
            if not row["hit"]:
                print(f"             expected {row['expected_slugs']}")
                print(f"             got      {row['retrieved_slugs']}")

    report: dict = {
        "top_k": TOP_K,
        "embedding_model": embedding_model,
        "retrieval": {
            suite: {
                "hit_rate": round(sum(1 for row in rows if row["hit"]) / len(rows), 4),
                "cases": [
                    {key: row[key] for key in ("question", "expected_slugs", "retrieved_slugs", "hit", "first_hit_rank")}
                    for row in rows
                ],
            }
            for suite, rows in retrieval.items()
        },
    }

    if not options.retrieval_only:
        openrouter_key = require(env, "OPENROUTER_API_KEY")
        print("\n  running ragas (this calls a judge model and costs money)…")
        scores = run_ragas(retrieval, env, openrouter_key, provider_key, embedding_model)
        for suite_name, metrics in scores.items():
            print(f"\n  {suite_name}:")
            for metric, value in metrics.items():
                print(f"    {metric:<20} {value}")
        report["ragas"] = scores

    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n  report written to {REPORT.relative_to(REPO_ROOT)}\n")

    total = sum(len(rows) for rows in retrieval.values())
    misses = sum(1 for rows in retrieval.values() for row in rows if not row["hit"])
    if misses:
        print(f"  {misses}/{total} golden cases missed their expected scenario\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
