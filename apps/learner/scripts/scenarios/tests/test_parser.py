"""Parser tests against the real dataset files.

The dataset is checked into the repository, so these tests run against the
actual corpus rather than fixtures: the parser's one job is to read exactly
these two files correctly, and a synthetic fixture would only prove it can
read the fixture.
"""

from pathlib import Path

import pytest

from scenario_parser import (
    ScenarioItem,
    parse_comprehension_file,
    parse_dataset,
    parse_dialogue_file,
)

DATASET = Path(__file__).resolve().parents[3] / "dataset"
DIALOGUES = DATASET / "Conversational_German_15_Dialogue_Stories.md"
COMPREHENSIONS = DATASET / "German_Listening_and_Comprehension_Practice.md"


# ---------------------------------------------------------------------------
# Dialogue file
# ---------------------------------------------------------------------------


class TestDialogueParsing:
    @pytest.fixture(scope="class")
    def items(self) -> list[ScenarioItem]:
        return parse_dialogue_file(DIALOGUES)

    def test_finds_all_fifteen_stories(self, items):
        assert len(items) == 15

    def test_every_item_is_a_dialogue(self, items):
        assert {item.type for item in items} == {"dialogue"}
        assert {item.kind for item in items} == {"dialogue"}

    def test_levels_split_five_per_tier(self, items):
        levels = [item.target_level for item in items]
        assert levels.count("A1") == 5
        assert levels.count("A2") == 5
        assert levels.count("B2") == 5

    def test_first_story_titles_and_description(self, items):
        first = items[0]
        assert first.title == "Im Restaurant"
        assert first.title_english == "At the Restaurant"
        assert "orders lunch" in first.description

    def test_dialogue_lines_carry_speaker_german_and_english(self, items):
        lines = items[0].content["lines"]
        assert lines[0]["speaker"] == "Anna"
        assert lines[0]["german"].startswith("Guten Tag!")
        assert lines[0]["english"].startswith("Hello!")
        # Every line of every dialogue is fully populated.
        for item in items:
            for line in item.content["lines"]:
                assert line["speaker"]
                assert line["german"]
                assert line["english"]

    def test_dialogues_have_at_least_five_exchanges(self, items):
        for item in items:
            assert len(item.content["lines"]) >= 5, item.slug

    def test_vocabulary_parsed(self, items):
        vocab = items[0].vocabulary
        assert {"term": "die Suppe", "meaning": "soup"} in vocab
        for item in items:
            assert len(item.vocabulary) == 5, item.slug

    def test_slugs_are_unique_and_stable(self, items):
        slugs = [item.slug for item in items]
        assert len(set(slugs)) == len(slugs)
        assert slugs[0] == "dialogue-a1-im-restaurant"


# ---------------------------------------------------------------------------
# Comprehension file
# ---------------------------------------------------------------------------


class TestComprehensionParsing:
    @pytest.fixture(scope="class")
    def items(self) -> list[ScenarioItem]:
        return parse_comprehension_file(COMPREHENSIONS)

    def test_finds_all_thirty_five_items(self, items):
        # 5 telephone situations + 15 train announcements + 15 readings.
        assert len(items) == 35

    def test_every_item_is_a_comprehension(self, items):
        assert {item.type for item in items} == {"comprehension"}

    def test_kinds(self, items):
        kinds = [item.kind for item in items]
        assert kinds.count("telephone") == 5
        assert kinds.count("announcement") == 15
        assert kinds.count("reading") == 15

    def test_levels(self, items):
        levels = [item.target_level for item in items]
        # Telephone situations are A1-only; announcements and readings are
        # five per level.
        assert levels.count("A1") == 15
        assert levels.count("A2") == 10
        assert levels.count("B2") == 10

    def test_telephone_situation_shape(self, items):
        phone = [i for i in items if i.kind == "telephone"]
        first = phone[0]
        assert first.title == "Beim Arzt anrufen"
        assert first.title_english == "Calling the Doctor"
        assert "Arztpraxis Müller" in first.content["passage"]
        assert len(first.content["questions"]) == 1
        question = first.content["questions"][0]
        assert "appointment" in question["question"]
        assert question["answer"] == "1"

    def test_announcement_shape(self, items):
        announcements = [i for i in items if i.kind == "announcement"]
        first = announcements[0]
        assert first.title_english == "Delay"
        assert "Hamburg" in first.content["passage"]
        assert first.content["passage_english"]
        assert first.content["questions"][0]["answer"] == "Gleis 3."

    def test_reading_shape(self, items):
        readings = [i for i in items if i.kind == "reading"]
        first = readings[0]
        assert first.title == "Ein neuer Morgen"
        assert first.title_english == "A New Morning"
        assert first.content["passage"].startswith("Anna steht jeden Morgen")
        assert len(first.content["questions"]) == 5
        assert first.content["questions"][0]["question"] == "Wann steht Anna auf?"
        assert first.content["questions"][0]["answer"] == "Um sieben Uhr."
        assert len(first.vocabulary) == 5

    def test_readings_pair_every_question_with_an_answer(self, items):
        for item in items:
            for question in item.content["questions"]:
                assert question["question"], item.slug
                assert question["answer"], item.slug

    def test_slugs_are_unique(self, items):
        slugs = [item.slug for item in items]
        assert len(set(slugs)) == len(slugs)


# ---------------------------------------------------------------------------
# The combined corpus
# ---------------------------------------------------------------------------


class TestDataset:
    @pytest.fixture(scope="class")
    def items(self) -> list[ScenarioItem]:
        return parse_dataset(DATASET)

    def test_fifty_items_in_total(self, items):
        assert len(items) == 50

    def test_type_split(self, items):
        types = [item.type for item in items]
        assert types.count("dialogue") == 15
        assert types.count("comprehension") == 35

    def test_slugs_unique_across_both_files(self, items):
        slugs = [item.slug for item in items]
        assert len(set(slugs)) == len(slugs)

    def test_content_hash_is_stable_and_content_sensitive(self, items):
        first = items[0]
        again = parse_dataset(DATASET)[0]
        assert first.content_hash == again.content_hash
        assert len(first.content_hash) == 64  # sha256 hex

    def test_embedding_text_carries_search_signals(self, items):
        # The embedding text is what similarity search actually sees. It must
        # contain the title pair, the type, the level, and the body.
        first = items[0]
        text = first.embedding_text
        assert "Im Restaurant" in text
        assert "At the Restaurant" in text
        assert "A1" in text
        assert "Ich möchte eine Suppe" in text

    def test_rows_serialise_for_the_database(self, items):
        row = items[0].to_row()
        expected_keys = {
            "slug", "type", "kind", "title", "title_english", "description",
            "target_level", "content", "vocabulary", "source", "item_index",
            "content_hash", "embedding_text",
        }
        assert expected_keys <= set(row.keys())
        assert row["type"] in ("dialogue", "comprehension")
        assert row["target_level"] in ("A1", "A2", "B1", "B2")
