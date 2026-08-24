"""Parse the scenario dataset into typed items.

The two source files under ``dataset/`` are the Markdown extraction of the
scenario PDFs. Each file has a rigid, hand-authored structure, and this module
turns that structure into explicit items of exactly two types:

* ``dialogue``       — a speaker-tagged German dialogue with English
                       translations, for interactive AI roleplay.
* ``comprehension``  — a German passage (reading text, telephone menu, or
                       train announcement) paired with comprehension questions
                       and their answers.

Classification is structural, not statistical: which file and which part of
that file an item comes from decides its type, so the same input always
produces the same classification. A finer ``kind`` (dialogue / reading /
telephone / announcement) is kept alongside the type for display and analysis.

Chunking strategy: one item is one embedding. Every item is a small,
self-contained pedagogical unit (well under the 8191-token embedding ceiling),
and splitting one across chunks would only let a query match half a scenario.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

DIALOGUE_FILE = "Conversational_German_15_Dialogue_Stories.md"
COMPREHENSION_FILE = "German_Listening_and_Comprehension_Practice.md"

SCENARIO_TYPES = ("dialogue", "comprehension")
SCENARIO_KINDS = ("dialogue", "reading", "telephone", "announcement")
SCENARIO_LEVELS = ("A1", "A2", "B1", "B2")

# --- shared line patterns ----------------------------------------------------

_TIER = re.compile(r"^#\s+Tier\s+\d+\s+—\s+Level\s+(A1|A2|B1|B2)\s*$")
_STORY = re.compile(r"^##\s+Story\s+\d+\s+—\s+(?P<de>.+?)\s+/\s+(?P<en>.+?)\s*$")
_SETTING = re.compile(r"^\*\*Scenario/Setting:\*\*\s*(?P<setting>.+?)\s*$")
_SPEAKER = re.compile(r"^\*\*(?P<speaker>[^*:]+):\*\*\s*(?P<german>.+?)\s*$")
_TRANSLATION = re.compile(r"^\((?P<english>.+)\)\s*$")
_VOCAB = re.compile(r"^-\s+\*\*(?P<term>.+?)\*\*\s+—\s+(?P<meaning>.+?)\s*$")

_PART = re.compile(r"^#\s+Part\s+(?P<part>[IVX]+)\s+—")
_LEVEL = re.compile(r"^#{1,2}\s+Level\s+(?P<level>A1|A2|B1|B2)\s+—")
_SITUATION = re.compile(
    r"^###\s+Situation\s+\d+\s+—\s+(?P<de>.+?)\s+/\s+(?P<en>.+?)\s*$",
)
_ANNOUNCEMENT = re.compile(r"^###\s+Announcement\s+\d+\s+—\s+(?P<en>.+?)\s*$")
_READING = re.compile(r"^##\s+(?P<de>[^#]+?)\s+/\s+(?P<en>.+?)\s*$")
_ANSAGE = re.compile(r"^\*\*Ansage:\*\*\s*(?P<german>.+?)\s*$")
_TASK = re.compile(r"^\*\*Task:\*\*\s*(?P<task>.+?)\s*$")
_ANSWER = re.compile(r"^\*\*Answer:\*\*\s*(?P<answer>.+?)\s*$")
_NUMBERED = re.compile(r"^(?P<number>\d+)\.\s+(?P<text>.+?)\s*$")


def _plain(text: str) -> str:
    """Strip Markdown emphasis; the database holds prose, not markup."""
    return text.replace("**", "").replace("*", "").strip()


def _slugify(text: str) -> str:
    """ASCII slug: lowercase, umlauts folded, everything else a hyphen."""
    folded = (
        unicodedata.normalize("NFKD", text)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", folded)).strip("-")


@dataclass(frozen=True)
class ScenarioItem:
    """One scenario, ready for the database."""

    type: str
    kind: str
    title: str
    title_english: str
    description: str
    target_level: str
    content: dict
    source: str
    item_index: int
    vocabulary: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.type not in SCENARIO_TYPES:
            raise ValueError(f"unknown scenario type: {self.type}")
        if self.kind not in SCENARIO_KINDS:
            raise ValueError(f"unknown scenario kind: {self.kind}")
        if self.target_level not in SCENARIO_LEVELS:
            raise ValueError(f"unknown level: {self.target_level}")

    @property
    def slug(self) -> str:
        prefix = (
            f"{self.type}-{self.target_level.lower()}"
            if self.kind == "dialogue"
            else f"{self.type}-{self.target_level.lower()}-{self.kind}"
        )
        return f"{prefix}-{_slugify(self.title)}"

    @property
    def embedding_text(self) -> str:
        """The exact text similarity search sees.

        Carries every signal a natural-language query could match on: both
        titles, the type and kind, the level, the description, the full body
        in German and English, and the vocabulary glosses.
        """
        lines = [
            f"{self.title} / {self.title_english}",
            f"Type: {self.type} ({self.kind}). Level: {self.target_level}.",
            self.description,
            "",
        ]

        if self.type == "dialogue":
            for line in self.content["lines"]:
                lines.append(f"{line['speaker']}: {line['german']}")
                lines.append(f"({line['english']})")
        else:
            lines.append(self.content["passage"])
            if self.content.get("passage_english"):
                lines.append(f"({self.content['passage_english']})")
            lines.append("")
            for question in self.content["questions"]:
                lines.append(f"Q: {question['question']}")

        if self.vocabulary:
            glosses = "; ".join(
                f"{entry['term']} — {entry['meaning']}" for entry in self.vocabulary
            )
            lines.append("")
            lines.append(f"Vocabulary: {glosses}")

        return "\n".join(lines).strip()

    @property
    def content_hash(self) -> str:
        """Hash of everything that would change what is stored or embedded."""
        canonical = json.dumps(
            {
                "type": self.type,
                "kind": self.kind,
                "title": self.title,
                "title_english": self.title_english,
                "description": self.description,
                "target_level": self.target_level,
                "content": self.content,
                "vocabulary": self.vocabulary,
                "embedding_text": self.embedding_text,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def to_row(self) -> dict:
        """The database row, without the embedding."""
        return {
            "slug": self.slug,
            "type": self.type,
            "kind": self.kind,
            "title": self.title,
            "title_english": self.title_english,
            "description": self.description,
            "target_level": self.target_level,
            "content": self.content,
            "vocabulary": self.vocabulary,
            "source": self.source,
            "item_index": self.item_index,
            "content_hash": self.content_hash,
            "embedding_text": self.embedding_text,
        }


# ---------------------------------------------------------------------------
# The dialogue file
# ---------------------------------------------------------------------------


def parse_dialogue_file(path: Path) -> list[ScenarioItem]:
    """Fifteen stories, five per tier, each a complete roleplay scenario."""
    items: list[ScenarioItem] = []
    level: str | None = None
    story: dict | None = None
    section: str | None = None

    def flush() -> None:
        nonlocal story
        if story is None:
            return
        items.append(
            ScenarioItem(
                type="dialogue",
                kind="dialogue",
                title=story["title"],
                title_english=story["title_english"],
                description=story["setting"],
                target_level=story["level"],
                content={"setting": story["setting"], "lines": story["lines"]},
                vocabulary=story["vocabulary"],
                source=path.name,
                item_index=len(items),
            ),
        )
        story = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        if tier := _TIER.match(line):
            level = tier.group(1)
            continue

        if match := _STORY.match(line):
            flush()
            if level is None:
                raise ValueError(f"story before any tier heading: {line}")
            story = {
                "title": match["de"],
                "title_english": match["en"],
                "level": level,
                "setting": "",
                "lines": [],
                "vocabulary": [],
            }
            section = None
            continue

        if story is None:
            continue

        if line == "### Dialogue":
            section = "dialogue"
            continue
        if line == "### Key Vocabulary":
            section = "vocabulary"
            continue
        if line.startswith("#"):
            # Any other heading (the study guide) ends the story.
            flush()
            section = None
            continue

        if match := _SETTING.match(line):
            story["setting"] = match["setting"]
        elif section == "dialogue":
            if match := _SPEAKER.match(line):
                story["lines"].append(
                    {"speaker": match["speaker"], "german": match["german"], "english": ""},
                )
            elif (match := _TRANSLATION.match(line)) and story["lines"]:
                story["lines"][-1]["english"] = match["english"]
        elif section == "vocabulary":
            if match := _VOCAB.match(line):
                story["vocabulary"].append(
                    {"term": _plain(match["term"]), "meaning": _plain(match["meaning"])},
                )

    flush()
    return items


# ---------------------------------------------------------------------------
# The comprehension file
# ---------------------------------------------------------------------------

# Which parts of the file hold items, and what kind each holds. Parts I, III
# and VI are strategy prose for the learner, not scenarios; they are skipped.
_PART_KINDS = {"II": "telephone", "IV": "announcement", "V": "reading"}


def parse_comprehension_file(path: Path) -> list[ScenarioItem]:
    """Thirty-five comprehension items across three kinds."""
    items: list[ScenarioItem] = []
    part: str | None = None
    level: str | None = None
    current: dict | None = None
    section: str | None = None

    def describe(kind: str, title_english: str, draft: dict) -> str:
        if kind == "telephone":
            return (
                f"An automated German telephone menu ({title_english}). "
                f"Task: {draft['task']}"
            )
        if kind == "announcement":
            return (
                f"A German train station announcement ({title_english}). "
                f"Task: {draft['task']}"
            )
        count = len(draft["questions"])
        return (
            f"A German reading passage ({title_english}) "
            f"with {count} comprehension questions."
        )

    def flush() -> None:
        nonlocal current
        if current is None:
            return
        kind = current["kind"]
        if kind in ("telephone", "announcement"):
            questions = [{"question": current["task"], "answer": current["answer"]}]
            passage_english = current.get("passage_english") or None
        else:
            questions = [
                {"question": question, "answer": answer}
                for question, answer in zip(
                    current["questions"], current["answers"], strict=True
                )
            ]
            passage_english = None

        draft = {"task": current.get("task", ""), "questions": questions}
        items.append(
            ScenarioItem(
                type="comprehension",
                kind=kind,
                title=current["title"],
                title_english=current["title_english"],
                description=describe(kind, current["title_english"], draft),
                target_level=current["level"],
                content={
                    "passage": current["passage"],
                    "passage_english": passage_english,
                    "questions": questions,
                },
                vocabulary=current["vocabulary"],
                source=path.name,
                item_index=len(items),
            ),
        )
        current = None

    def start(kind: str, title: str, title_english: str) -> dict:
        if level is None:
            raise ValueError(f"item before any level heading: {title}")
        return {
            "kind": kind,
            "title": title,
            "title_english": title_english,
            "level": level,
            "passage": "",
            "passage_english": "",
            "task": "",
            "answer": "",
            "questions": [],
            "answers": [],
            "vocabulary": [],
        }

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        if match := _PART.match(line):
            flush()
            part = match["part"]
            level = None
            continue

        if match := _LEVEL.match(line):
            # In part V every item has its own "# Level X — Comprehension N"
            # heading, so a level heading is also an item boundary there.
            flush()
            level = match["level"]
            if part == "V":
                current = None
                section = "awaiting-title"
            continue

        kind = _PART_KINDS.get(part or "")
        if kind is None:
            continue

        if kind == "telephone" and (match := _SITUATION.match(line)):
            flush()
            current = start("telephone", match["de"], match["en"])
            section = None
            continue

        if kind == "announcement" and (match := _ANNOUNCEMENT.match(line)):
            flush()
            title = match["en"]
            current = start("announcement", title, title)
            section = None
            continue

        if kind == "reading" and section == "awaiting-title" and (match := _READING.match(line)):
            current = start("reading", match["de"], match["en"])
            section = None
            continue

        if current is None:
            continue

        if line == "**Text**":
            section = "text"
            continue
        if line == "### Questions":
            section = "questions"
            continue
        if line == "### Answers":
            section = "answers"
            continue
        if line == "### Key Vocabulary":
            section = "vocabulary"
            continue
        if line.startswith("#"):
            section = None
            continue

        if match := _ANSAGE.match(line):
            current["passage"] = match["german"]
            section = "ansage-translation"
        elif section == "ansage-translation" and (match := _TRANSLATION.match(line)):
            current["passage_english"] = match["english"]
            section = None
        elif match := _TASK.match(line):
            current["task"] = _plain(match["task"])
        elif match := _ANSWER.match(line):
            current["answer"] = _plain(match["answer"])
        elif section == "text" and line and not line.startswith(("#", "**", "-", "|")):
            current["passage"] = f"{current['passage']} {line}".strip()
        elif section == "questions" and (match := _NUMBERED.match(line)):
            current["questions"].append(_plain(match["text"]))
        elif section == "answers" and (match := _NUMBERED.match(line)):
            current["answers"].append(_plain(match["text"]))
        elif section == "vocabulary" and (match := _VOCAB.match(line)):
            current["vocabulary"].append(
                {"term": _plain(match["term"]), "meaning": _plain(match["meaning"])},
            )

    flush()
    return items


# ---------------------------------------------------------------------------
# The whole corpus
# ---------------------------------------------------------------------------


def parse_dataset(dataset_dir: Path) -> list[ScenarioItem]:
    """Every scenario in the dataset, dialogues first, in file order."""
    items = [
        *parse_dialogue_file(dataset_dir / DIALOGUE_FILE),
        *parse_comprehension_file(dataset_dir / COMPREHENSION_FILE),
    ]

    slugs: set[str] = set()
    for item in items:
        if item.slug in slugs:
            raise ValueError(f"duplicate scenario slug: {item.slug}")
        slugs.add(item.slug)

    return items
