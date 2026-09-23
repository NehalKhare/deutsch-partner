"""Tests for the ingestion plan — the pure logic between parsing and I/O."""

from pathlib import Path

import pytest

from ingest_scenarios import IngestionPlan, load_env_files, plan_ingestion, vector_literal
from scenario_parser import parse_dataset

DATASET = Path(__file__).resolve().parents[3] / "dataset"


@pytest.fixture(scope="module")
def items():
    return parse_dataset(DATASET)


class TestPlan:
    def test_everything_is_new_on_an_empty_database(self, items):
        plan = plan_ingestion(items, existing={}, force=False)
        assert len(plan.to_embed) == 50
        assert plan.unchanged == []
        assert set(plan.stale_slugs_by_source.keys()) == {
            "Conversational_German_15_Dialogue_Stories.md",
            "German_Listening_and_Comprehension_Practice.md",
        }
        assert all(slugs == [] for slugs in plan.stale_slugs_by_source.values())

    def test_unchanged_items_are_skipped(self, items):
        existing = {item.slug: item.content_hash for item in items}
        plan = plan_ingestion(items, existing, force=False)
        assert plan.to_embed == []
        assert len(plan.unchanged) == 50

    def test_a_changed_hash_is_re_embedded(self, items):
        existing = {item.slug: item.content_hash for item in items}
        existing[items[0].slug] = "0" * 64
        plan = plan_ingestion(items, existing, force=False)
        assert [item.slug for item in plan.to_embed] == [items[0].slug]
        assert len(plan.unchanged) == 49

    def test_force_re_embeds_everything(self, items):
        existing = {item.slug: item.content_hash for item in items}
        plan = plan_ingestion(items, existing, force=True)
        assert len(plan.to_embed) == 50

    def test_rows_no_longer_produced_are_marked_stale(self, items):
        existing = {item.slug: item.content_hash for item in items}
        existing["dialogue-a1-gone"] = "f" * 64
        plan = plan_ingestion(items, existing, force=False)
        stale = plan.stale_slugs_by_source["Conversational_German_15_Dialogue_Stories.md"]
        assert stale == ["dialogue-a1-gone"]

    def test_plan_is_a_frozen_report(self, items):
        plan = plan_ingestion(items, existing={}, force=False)
        assert isinstance(plan, IngestionPlan)


class TestVectorLiteral:
    def test_pgvector_string_form(self):
        assert vector_literal([0.1, -0.2, 3.0]) == "[0.1,-0.2,3.0]"


class TestEnvFiles:
    def test_env_local_wins_over_env(self, tmp_path):
        (tmp_path / ".env").write_text("A=from-env\nB=only-env\n")
        (tmp_path / ".env.local").write_text('A="from-local"\n# comment\n\n')
        env = load_env_files(tmp_path)
        assert env["A"] == "from-local"
        assert env["B"] == "only-env"
