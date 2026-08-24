import { CEFR_LEVELS, miniLevelRangeFor, type CEFRLevel } from "@/domain/cefr";
import { GENDERS } from "@/domain/vocabulary";
import { GRAMMAR_LABELS } from "@/learning/grammar-labels";
import { MINI_LEVEL_CURRICULUM } from "@/learning/mini-levels";
import { VOCABULARY_CATALOGUE } from "@/learning/vocabulary-catalogue";

type Gender = (typeof GENDERS)[number];

/**
 * The syllabus, as something a learner can read.
 *
 * Everything here already existed and none of it was reachable: seventy
 * mini-levels of themes and grammar in the curriculum, four hundred and twenty
 * words with their gender, plural, English and a German definition in the
 * lexicon — and no page that showed a learner any of it. This assembles the
 * view and computes nothing that is not already true.
 *
 * Pure, and therefore testable without a database. The learner's own position
 * arrives as an argument rather than being read here.
 */

export const ARTICLES: readonly Gender[] = ["der", "die", "das"];

export interface BrowsedWord {
  /** As the curriculum names it, article and all: "der Bahnhof". */
  readonly word: string;
  readonly english: string;
  /** The article alone, for the one thing every learner of German struggles with. */
  readonly article: Gender | null;
  /** Null where the noun has no plural in ordinary use, or is not a noun. */
  readonly plural: string | null;
  readonly example: string;
  /**
   * Whether this is a word a learner needs whatever they are interested in.
   * A1 and A2 words all are; B1 words follow the topic they arrived under.
   */
  readonly core: boolean;
}

export interface BrowsedLevel {
  readonly miniLevel: number;
  readonly theme: string;
  readonly focus: string;
  /** Readable grammar names, not slugs. */
  readonly grammar: readonly string[];
  readonly words: readonly BrowsedWord[];
}

export interface ArticleGroup {
  readonly article: Gender;
  readonly words: readonly BrowsedWord[];
}

export interface BrowsedBand {
  readonly level: CEFRLevel;
  readonly first: number;
  readonly last: number;
  readonly levels: readonly BrowsedLevel[];
  /**
   * Every noun in the band, grouped by its article.
   *
   * Separated out deliberately. Gender is the single most repeated thing a
   * learner of German gets wrong, and it is not learnable from a word list
   * where the articles are scattered — seeing the three columns side by side
   * is the practice.
   */
  readonly byArticle: readonly ArticleGroup[];
  readonly wordCount: number;
  readonly nounCount: number;
}

function toWord(item: (typeof VOCABULARY_CATALOGUE)[number]): BrowsedWord {
  return {
    word: item.word,
    english: item.englishTranslation,
    article: item.gender,
    plural: item.plural,
    example: item.example,
    core: item.isCoreWord,
  };
}

/** A readable grammar name, falling back to the slug rather than to nothing. */
function grammarLabel(slug: string): string {
  return GRAMMAR_LABELS[slug] ?? slug.replaceAll("_", " ");
}

export function isCefrLevel(value: unknown): value is CEFRLevel {
  return (CEFR_LEVELS as readonly unknown[]).includes(value);
}

/** The level to show, from a URL that a learner can type anything into. */
export function levelToBrowse(
  requested: unknown,
  fallback: CEFRLevel,
): CEFRLevel {
  return isCefrLevel(requested) ? requested : fallback;
}

export function browseBand(level: CEFRLevel): BrowsedBand {
  const { first, last } = miniLevelRangeFor(level);

  const levels = MINI_LEVEL_CURRICULUM.filter(
    (entry) => entry.miniLevel >= first && entry.miniLevel <= last,
  ).map((entry): BrowsedLevel => {
    const words = VOCABULARY_CATALOGUE.filter(
      (item) => item.miniLevel === entry.miniLevel,
    ).map(toWord);

    return {
      miniLevel: entry.miniLevel,
      theme: entry.theme,
      focus: entry.focus,
      grammar: entry.targetGrammar.map(grammarLabel),
      words,
    };
  });

  const words = levels.flatMap((entry) => entry.words);
  const nouns = words.filter((word) => word.article !== null);

  const byArticle = ARTICLES.map((article) => ({
    article,
    // Alphabetical within a group: a learner scanning for a word wants to find
    // it, and the order words were introduced in is meaningless across levels.
    words: nouns
      .filter((word) => word.article === article)
      .sort((left, right) => left.word.localeCompare(right.word, "de")),
  }));

  return {
    level,
    first,
    last,
    levels,
    byArticle,
    wordCount: words.length,
    nounCount: nouns.length,
  };
}
