import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { GRAMMAR_CATALOGUE } from "@/learning/grammar-catalogue";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import { MINI_LEVEL_CURRICULUM } from "@/learning/mini-levels";
import { VOCABULARY_CATALOGUE } from "@/learning/vocabulary-catalogue";
import type { SourceDocumentInput } from "@/lib/ingestion/document";

/**
 * The corpus derived from content this repository already owns.
 *
 * Seventy mini-levels, eighty-six grammar patterns and four hundred and twenty
 * words are already hand-authored here as the structured curriculum. They are
 * also, in prose form, exactly the explanations, patterns and level material
 * the vector store is for.
 *
 * Deriving them rather than writing a second copy by hand has two consequences
 * worth stating. The corpus is licence-clean and attributable to this project,
 * so no third-party text ends up in a prompt nobody can account for. And it
 * cannot drift from the structured tables, because it is generated from them:
 * a grammar explanation edited in the seed file re-ingests under a new hash
 * and the chunk it replaces is removed.
 *
 * External material is dropped into `content/` and loaded alongside this; see
 * sources/files.ts.
 */

const SOURCE = "deutsch-partner/curriculum";
const LICENCE = "Deutsch Partner, internal curriculum content";

function grammarDocuments(): SourceDocumentInput[] {
  return GRAMMAR_CATALOGUE.map((pattern) => {
    const examples = pattern.examples.map((example) => `- ${example}`).join("\n");
    const mistakes = pattern.commonMistakes.map((mistake) => `- ${mistake}`).join("\n");

    return {
      source: `${SOURCE}/grammar/${pattern.key}`,
      title: `Grammar: ${pattern.name}`,
      contentType: "grammar",
      // The explanation is English by design: an A1 learner cannot read a
      // German explanation of the case that would let them read it.
      language: "en",
      cefr: pattern.cefr,
      miniLevel: pattern.miniLevel,
      grammarTarget: pattern.key,
      skill: "grammar",
      difficulty: pattern.difficulty,
      license: LICENCE,
      body: [
        `## ${pattern.name}`,
        "",
        pattern.explanation,
        "",
        "### Examples",
        examples,
        ...(mistakes.length > 0 ? ["", "### Common mistakes", mistakes] : []),
      ].join("\n"),
      metadata: { grammarKey: pattern.key },
    } satisfies SourceDocumentInput;
  });
}

function curriculumDocuments(): SourceDocumentInput[] {
  return MINI_LEVEL_CURRICULUM.map((level, index) => {
    const entry = CURRICULUM_ENTRIES[index];
    const grammar = level.targetGrammar
      .map((key) => `- ${GRAMMAR_LABELS[key] ?? key}`)
      .join("\n");

    return {
      source: `${SOURCE}/mini-level/${level.miniLevel}`,
      title: `Mini-level ${level.miniLevel}: ${level.theme}`,
      contentType: "curriculum",
      language: "en",
      cefr: level.cefr,
      miniLevel: level.miniLevel,
      topic: entry?.topic ?? null,
      license: LICENCE,
      body: [
        `## Mini-level ${level.miniLevel} — ${level.theme}`,
        "",
        `This level is about ${level.focus}.`,
        "",
        "### Target vocabulary",
        level.targetVocabulary.map((word) => `- ${word}`).join("\n"),
        "",
        "### Grammar in focus",
        grammar,
        "",
        "### What a learner should be able to do",
        level.conversationFunctions.map((item) => `- ${item}`).join("\n"),
        "",
        "### Listening and reading goals",
        level.comprehensionGoals.map((item) => `- ${item}`).join("\n"),
        "",
        "### Speaking and writing goals",
        level.productionGoals.map((item) => `- ${item}`).join("\n"),
      ].join("\n"),
      metadata: { theme: level.theme },
    } satisfies SourceDocumentInput;
  });
}

/**
 * Vocabulary, grouped by the mini-level that teaches it.
 *
 * One document per word would produce four hundred and twenty documents whose
 * only chunk is a line long, which retrieves badly: a single word carries
 * almost no context for a question to match against. A level's worth of words
 * shares a topic and a register, which is the conceptual unit the chunking
 * guidance asks for — and each word stays its own chunk inside it, separated
 * by a hard break so no two are ever packed together to hit a size target.
 */
function vocabularyDocuments(): SourceDocumentInput[] {
  const byLevel = new Map<number, (typeof VOCABULARY_CATALOGUE)[number][]>();

  for (const item of VOCABULARY_CATALOGUE) {
    const existing = byLevel.get(item.miniLevel);
    if (existing) existing.push(item);
    else byLevel.set(item.miniLevel, [item]);
  }

  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([miniLevel, items]) => {
      const level = MINI_LEVEL_CURRICULUM.find(
        (candidate) => candidate.miniLevel === miniLevel,
      );

      return {
        source: `${SOURCE}/vocabulary/${miniLevel}`,
        title: `Vocabulary for mini-level ${miniLevel}${level ? `: ${level.theme}` : ""}`,
        contentType: "vocabulary",
        language: "de",
        cefr: items[0].cefr,
        miniLevel,
        topic: items[0].topic,
        skill: "vocabulary",
        license: LICENCE,
        body: items
          .map((item) =>
            [
              `**${item.word}** (${item.partOfSpeech})`,
              item.germanDefinition,
              `Englisch: ${item.englishTranslation}`,
              `Beispiel: ${item.example}`,
            ].join("\n"),
          )
          .join("\n\n---\n\n"),
        metadata: { wordCount: items.length },
      } satisfies SourceDocumentInput;
    });
}

export function derivedDocuments(): readonly SourceDocumentInput[] {
  return [...curriculumDocuments(), ...grammarDocuments(), ...vocabularyDocuments()];
}
