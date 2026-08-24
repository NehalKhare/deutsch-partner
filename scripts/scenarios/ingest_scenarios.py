"""Ingest the scenario corpus into the vector store.

Run from the repository root (or this directory):

    uv run --project scripts/scenarios scripts/scenarios/ingest_scenarios.py [--dry-run] [--force]

Parses the two dataset files, classifies every item as a ``dialogue`` or a
``comprehension``, embeds what changed through the OpenRouter embeddings API
(``openai/text-embedding-3-small`` unless ``EMBEDDING_MODEL`` overrides it —
the same model and 1536-dimension width the application's retrieval gateway
uses, so query vectors and corpus vectors stay comparable), and upserts into
the ``scenarios`` table through PostgREST with the secret key. Authentication
uses ``OPENROUTER_API_KEY``, falling back to ``OPENAI_API_KEY`` for a
deployment mid-migration.

Idempotent by construction, like the TypeScript corpus pipeline: an item is
keyed by its slug and carries the hash of its own content, an unchanged hash
is skipped before anything is embedded, and a slug the dataset no longer
produces is deleted. Re-running over an unchanged dataset costs nothing and
writes nothing. ``--dry-run`` reports what would happen without needing a
key or a database.

Deliberate limitation, stated rather than hidden: this offline script calls
the embedding provider directly, so its calls are not written to the
application's usage ledger or counted against the euro budgets (the CI
boundary that enforces gateway-only model access scans the TypeScript source
tree; this script is the same kind of exception `pnpm ingest --dry-run`
documents for operators). The run prints its token usage so the cost is
visible where it is incurred.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

from scenario_parser import ScenarioItem, parse_dataset

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = REPO_ROOT / "dataset"

DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
EMBEDDING_BATCH = 96
EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------


def load_env_files(root: Path) -> dict[str, str]:
    """Read ``.env`` then ``.env.local``, the later file winning.

    A tiny parser on purpose: KEY=VALUE lines, comments and blanks skipped,
    optional single or double quotes stripped. The Next.js app validates the
    same files with a real schema; this script only needs four values.
    """
    values: dict[str, str] = {}
    for name in (".env", ".env.local"):
        path = root / name
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def require(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        sys.exit(f"\n  {key} is not set. Add it to .env.local.\n")
    return value


def embedding_key(env: dict[str, str]) -> str:
    """OPENROUTER_API_KEY, or OPENAI_API_KEY as a mid-migration fallback —
    the fallback only authenticates if that key is valid for OpenRouter."""
    value = env.get("OPENROUTER_API_KEY", "").strip() or env.get("OPENAI_API_KEY", "").strip()
    if not value:
        sys.exit("\n  OPENROUTER_API_KEY is not set. Add it to .env.local.\n")
    return value


# ---------------------------------------------------------------------------
# The plan: pure logic, tested without a network
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IngestionPlan:
    to_embed: list[ScenarioItem]
    unchanged: list[ScenarioItem]
    stale_slugs_by_source: dict[str, list[str]]


def plan_ingestion(
    items: list[ScenarioItem],
    existing: dict[str, str],
    force: bool,
) -> IngestionPlan:
    """Decide what to embed, what to skip, and what to prune.

    ``existing`` maps slug -> content_hash as currently stored. An item whose
    stored hash matches is skipped entirely; a stored slug no item produces
    any more is stale, scoped per source file so this script never deletes a
    row some other pipeline wrote.
    """
    to_embed = [
        item
        for item in items
        if force or existing.get(item.slug) != item.content_hash
    ]
    unchanged = [item for item in items if item not in to_embed]

    produced = {item.slug for item in items}
    sources = sorted({item.source for item in items})
    prefixes = {source: set() for source in sources}
    for item in items:
        prefixes[item.source].add(item.slug)

    stale: dict[str, list[str]] = {source: [] for source in sources}
    for slug in existing:
        if slug in produced:
            continue
        # A stale slug is attributed to the file whose items share its type
        # prefix; anything unrecognised goes to the first source so it is
        # still reported.
        owner = next(
            (source for source, slugs in prefixes.items()
             if any(slug.split("-")[0] == known.split("-")[0] for known in slugs)),
            sources[0],
        )
        stale[owner].append(slug)

    return IngestionPlan(to_embed=to_embed, unchanged=unchanged, stale_slugs_by_source=stale)


def vector_literal(embedding: list[float]) -> str:
    """pgvector's input form — the same shape the app's repositories write."""
    return "[" + ",".join(repr(value) for value in embedding) + "]"


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def fetch_existing(client: httpx.Client, rest_url: str) -> dict[str, str]:
    response = client.get(
        f"{rest_url}/scenarios",
        params={"select": "slug,content_hash", "limit": "1000"},
    )
    response.raise_for_status()
    return {row["slug"]: row["content_hash"] for row in response.json()}


def embed_texts(
    client: httpx.Client,
    api_key: str,
    model: str,
    texts: list[str],
) -> tuple[list[list[float]], int]:
    """Embed in batches; returns vectors in input order and total tokens."""
    vectors: list[list[float]] = []
    tokens = 0
    for start in range(0, len(texts), EMBEDDING_BATCH):
        batch = texts[start : start + EMBEDDING_BATCH]
        response = client.post(
            EMBEDDINGS_URL,
            headers={"authorization": f"Bearer {api_key}"},
            json={"model": model, "input": batch, "dimensions": EMBEDDING_DIMENSIONS},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
        ordered = sorted(payload["data"], key=lambda entry: entry["index"])
        if len(ordered) != len(batch):
            sys.exit("\n  the provider returned a different number of vectors than sent\n")
        vectors.extend(entry["embedding"] for entry in ordered)
        tokens += int(payload.get("usage", {}).get("prompt_tokens", 0))
    return vectors, tokens


def upsert_rows(client: httpx.Client, rest_url: str, rows: list[dict]) -> None:
    response = client.post(
        f"{rest_url}/scenarios",
        params={"on_conflict": "slug"},
        headers={"prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
        timeout=60.0,
    )
    if response.status_code >= 400:
        sys.exit(f"\n  upsert failed ({response.status_code}): {response.text[:500]}\n")


def prune_stale(
    client: httpx.Client,
    rest_url: str,
    source: str,
    slugs: list[str],
) -> None:
    if not slugs:
        return
    quoted = ",".join(f'"{slug}"' for slug in slugs)
    response = client.delete(
        f"{rest_url}/scenarios",
        params={"source": f"eq.{source}", "slug": f"in.({quoted})"},
    )
    if response.status_code >= 400:
        sys.exit(f"\n  prune failed ({response.status_code}): {response.text[:500]}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--dry-run", action="store_true", help="report without writing")
    arguments.add_argument("--force", action="store_true", help="re-embed everything")
    options = arguments.parse_args()

    items = parse_dataset(DATASET_DIR)
    dialogues = sum(1 for item in items if item.type == "dialogue")
    comprehensions = len(items) - dialogues

    print(f"\n  {len(items)} scenarios parsed: {dialogues} dialogues, {comprehensions} comprehensions")
    for level in ("A1", "A2", "B1", "B2"):
        count = sum(1 for item in items if item.target_level == level)
        if count:
            print(f"    {level}: {count}")

    if options.dry_run:
        # No key, no database: report what would be written and stop.
        print()
        for item in items:
            approx = len(item.embedding_text) // 4
            print(f"  {item.type:<13} {item.kind:<12} {item.target_level}  ~{approx:>4} tokens  {item.slug}")
        print(f"\n  dry run: nothing embedded, nothing written\n")
        return

    env = load_env_files(REPO_ROOT)
    supabase_url = require(env, "NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
    secret_key = require(env, "SUPABASE_SECRET_KEY")
    provider_key = embedding_key(env)
    model = env.get("EMBEDDING_MODEL", "").strip() or DEFAULT_EMBEDDING_MODEL
    rest_url = f"{supabase_url}/rest/v1"

    with httpx.Client(
        headers={"apikey": secret_key, "authorization": f"Bearer {secret_key}"},
        timeout=30.0,
    ) as supabase, httpx.Client() as openrouter:
        existing = fetch_existing(supabase, rest_url)
        plan = plan_ingestion(items, existing, force=options.force)

        print(f"\n  {len(plan.to_embed)} to embed, {len(plan.unchanged)} unchanged")

        tokens = 0
        if plan.to_embed:
            texts = [item.embedding_text for item in plan.to_embed]
            vectors, tokens = embed_texts(openrouter, provider_key, model, texts)
            rows = [
                {**item.to_row(), "embedding": vector_literal(vector), "embedding_model": model}
                for item, vector in zip(plan.to_embed, vectors, strict=True)
            ]
            upsert_rows(supabase, rest_url, rows)

        for source, slugs in plan.stale_slugs_by_source.items():
            if slugs:
                print(f"  pruning {len(slugs)} stale row(s) from {source}")
                prune_stale(supabase, rest_url, source, slugs)

        print(
            f"\n  done: {len(plan.to_embed)} embedded and written, "
            f"{len(plan.unchanged)} skipped, {tokens} embedding tokens\n"
        )


if __name__ == "__main__":
    main()
