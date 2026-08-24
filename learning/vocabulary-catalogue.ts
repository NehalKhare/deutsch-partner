import { cefrForMiniLevel } from "@/domain/cefr";
import type { VocabularyItem } from "@/domain/vocabulary";
import { CURRICULUM_ENTRIES } from "@/learning/curriculum";
import { LEXICON, type WordSeed } from "@/learning/lexicon";

/**
 * The catalogue: every target word as a row the database can hold.
 *
 * Two sources meet here and neither repeats the other. The curriculum says
 * which words belong to which mini-level; the lexicon says what each word
 * means. Level, CEFR band and topic are read from the curriculum, so a word
 * cannot claim a level the syllabus never gave it.
 *
 * No id: `(lemma, part_of_speech)` is unique in the database and is what the
 * seed conflicts on, so the rows are stable across re-seeding without this
 * module having to invent identifiers.
 */

export type VocabularySeedItem = Omit<VocabularyItem, "id">;

/**
 * Words introduced earlier are the ones a learner meets most often, so the
 * band follows the position on the path rather than being asserted per word.
 */
function frequencyBandFor(miniLevel: number): number {
  return Math.min(10, Math.ceil(miniLevel / 8));
}

/**
 * A1 and A2 words are needed whatever a learner is interested in. B1 words
 * follow the topic they were introduced under, so they are not core.
 */
const LAST_CORE_MINI_LEVEL = 35;

const byWord = new Map<string, WordSeed>(LEXICON.map((seed) => [seed.word, seed]));

function toItem(seed: WordSeed, miniLevel: number, topic: string): VocabularySeedItem {
  return {
    lemma: seed.lemma,
    word: seed.word,
    partOfSpeech: seed.partOfSpeech,
    gender: seed.gender,
    plural: seed.plural,
    englishTranslation: seed.english,
    germanDefinition: seed.definition,
    example: seed.example,
    collocations: [],
    commonMistakes: [],
    cefr: cefrForMiniLevel(miniLevel),
    miniLevel,
    topic,
    frequencyBand: frequencyBandFor(miniLevel),
    isCoreWord: miniLevel <= LAST_CORE_MINI_LEVEL,
  };
}

export const VOCABULARY_CATALOGUE: readonly VocabularySeedItem[] = Object.freeze(
  CURRICULUM_ENTRIES.flatMap((entry, index) =>
    entry.vocabulary.map((word) => {
      const seed = byWord.get(word);

      // Unreachable while the drift test passes; throwing here means the
      // catalogue is never silently short of a word the syllabus promised.
      if (!seed) throw new Error(`no lexicon entry for ${word}`);

      return toItem(seed, index + 1, entry.topic);
    }),
  ),
);
