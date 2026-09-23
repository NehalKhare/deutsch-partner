import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MINI_LEVEL_CURRICULUM } from "../../src/mini-levels";
import { CULTURE_CATALOGUE } from "../../src/culture-catalogue";
import { CULTURE_MIGRATION_FILE } from "../../src/culture-sql";
import { GRAMMAR_CATALOGUE } from "../../src/grammar-catalogue";
import { VOCABULARY_CATALOGUE } from "../../src/vocabulary-catalogue";
import { GRAMMAR_MIGRATION_FILE } from "../../src/grammar-sql";
import { VOCABULARY_MIGRATION_FILE } from "../../src/vocabulary-sql";
import { MIGRATIONS_DIR, createTestDatabase, type TestDatabase } from "@dp/db/testing/harness";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.close();
});

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await database.db.query(sql, params)).rows as T[];
}

describe("the seeded curriculum", () => {
  it("puts every mini-level in the database", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.mini_levels`,
    );

    expect(Number(count)).toBe(MINI_LEVEL_CURRICULUM.length);
  });

  it("stores the same themes the application ships", async () => {
    const stored = await rows<{ mini_level: number; theme: string }>(
      `select mini_level, theme from public.mini_levels order by mini_level`,
    );

    expect(stored).toEqual(
      MINI_LEVEL_CURRICULUM.map((level) => ({
        mini_level: level.miniLevel,
        theme: level.theme,
      })),
    );
  });

  it("keeps the mastery criteria queryable rather than opaque", async () => {
    const [row] = await rows<{ vocabulary_mastered: number }>(
      `select (mastery_criteria ->> 'vocabularyMastered')::int as vocabulary_mastered
       from public.mini_levels where mini_level = 1`,
    );

    expect(row.vocabulary_mastered).toBe(
      MINI_LEVEL_CURRICULUM[0].masteryCriteria.vocabularyMastered,
    );
  });

  it("keeps target vocabulary as an array, not a joined string", async () => {
    const [row] = await rows<{ words: string[] }>(
      `select target_vocabulary as words from public.mini_levels where mini_level = 1`,
    );

    expect(row.words).toEqual(MINI_LEVEL_CURRICULUM[0].targetVocabulary);
  });

  it("lets a new learner start at mini-level 1", async () => {
    // Without the seed this foreign key has nothing to point at, and
    // onboarding fails on the very first write.
    const [row] = await rows<{ mini_level: number }>(
      `select mini_level from public.mini_levels where mini_level = 1`,
    );

    expect(row.mini_level).toBe(1);
  });
});

describe("the seeded vocabulary", () => {
  it("puts every target word in the database", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.vocabulary_items`,
    );

    expect(Number(count)).toBe(VOCABULARY_CATALOGUE.length);
  });

  it("gives every mini-level words of its own", async () => {
    const covered = await rows<{ mini_level: number }>(
      `select distinct mini_level from public.vocabulary_items order by mini_level`,
    );

    expect(covered.map((row) => row.mini_level)).toEqual(
      MINI_LEVEL_CURRICULUM.map((level) => level.miniLevel),
    );
  });

  it("stores the same lexical detail the application ships", async () => {
    const expected = VOCABULARY_CATALOGUE.find((item) => item.lemma === "Bahnhof");

    const [row] = await rows<{
      word: string;
      gender: string;
      plural: string;
      english_translation: string;
      mini_level: number;
      topic: string;
    }>(
      `select word, gender, plural, english_translation, mini_level, topic
       from public.vocabulary_items where lemma = 'Bahnhof'`,
    );

    expect(row).toEqual({
      word: expected!.word,
      gender: expected!.gender,
      plural: expected!.plural,
      english_translation: expected!.englishTranslation,
      mini_level: expected!.miniLevel,
      topic: expected!.topic,
    });
  });

  it("carries a gender on nouns and on nothing else", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.vocabulary_items
       where (part_of_speech = 'noun') <> (gender is not null)`,
    );

    expect(Number(count)).toBe(0);
  });

  it("re-seeds without adding a second row for the same word", async () => {
    // The seed conflicts on the natural key. Running it twice is how content
    // updates reach a database that already has the earlier rows.
    const before = await rows<{ count: string }>(
      `select count(*)::text as count from public.vocabulary_items`,
    );

    await database.db.exec(
      readFileSync(
        join(MIGRATIONS_DIR, VOCABULARY_MIGRATION_FILE),
        "utf8",
      ),
    );

    const after = await rows<{ count: string }>(
      `select count(*)::text as count from public.vocabulary_items`,
    );

    expect(after[0].count).toBe(before[0].count);
  });

  it("serves the review query from the index it was given", async () => {
    const plan = await rows<{ "QUERY PLAN": string }>(
      `explain select * from public.vocabulary_items
       where cefr = 'A1' and topic = 'travel'`,
    );

    expect(plan.map((row) => row["QUERY PLAN"]).join(" ")).toMatch(
      /vocabulary_items_cefr_topic_idx/,
    );
  });
});

describe("the seeded grammar patterns", () => {
  it("puts every pattern in the database", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns
       where category = 'grammar'`,
    );

    expect(Number(count)).toBe(GRAMMAR_CATALOGUE.length);
  });

  it("stores the explanation and the corrections the tutor will quote", async () => {
    const expected = GRAMMAR_CATALOGUE.find((p) => p.key === "perfekt_with_sein");

    const [row] = await rows<{
      name: string;
      examples: string[];
      common_mistakes: string[];
      difficulty: number;
      mini_level: number;
    }>(
      `select name, examples, common_mistakes, difficulty, mini_level
       from public.grammar_patterns where key = 'perfekt_with_sein'`,
    );

    expect(row).toEqual({
      name: expected!.name,
      examples: expected!.examples,
      common_mistakes: expected!.commonMistakes,
      difficulty: expected!.difficulty,
      mini_level: expected!.miniLevel,
    });
  });

  it("leaves no related key pointing at a pattern that is not there", async () => {
    // The database cannot express this as a foreign key, because the column
    // is an array. Nothing else would notice a broken cross-reference.
    const dangling = await rows<{ key: string; missing: string }>(
      `select p.key, r.missing
       from public.grammar_patterns p,
            lateral unnest(p.related_pattern_keys) as r(missing)
       where not exists (
         select 1 from public.grammar_patterns q where q.key = r.missing
       )`,
    );

    expect(dangling).toEqual([]);
  });

  it("gives every mini-level grammar of its own to teach", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.mini_levels m
       where not exists (
         select 1 from public.grammar_patterns g
         where g.key = any (m.target_grammar)
       )`,
    );

    expect(Number(count)).toBe(0);
  });

  it("re-seeds without adding a second row for the same pattern", async () => {
    const before = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns`,
    );

    await database.db.exec(
      readFileSync(join(MIGRATIONS_DIR, GRAMMAR_MIGRATION_FILE), "utf8"),
    );

    const after = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns`,
    );

    expect(after[0].count).toBe(before[0].count);
  });
});

describe("the seeded culture notes", () => {
  it("puts every note in the database, behind its category", async () => {
    const [{ count }] = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns
       where category = 'culture'`,
    );

    expect(Number(count)).toBe(CULTURE_CATALOGUE.length);
  });

  it("stores the first note at the first level that teaches it", async () => {
    const expected = CULTURE_CATALOGUE.find((note) => note.key === "du_oder_sie");

    const [row] = await rows<{
      name: string;
      mini_level: number;
      category: string;
    }>(
      `select name, mini_level, category
       from public.grammar_patterns where key = 'du_oder_sie'`,
    );

    expect(row).toEqual({
      name: expected!.name,
      mini_level: 1,
      category: "culture",
    });
  });

  it("re-seeds without adding a second row for the same note", async () => {
    const before = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns`,
    );

    await database.db.exec(
      readFileSync(join(MIGRATIONS_DIR, CULTURE_MIGRATION_FILE), "utf8"),
    );

    const after = await rows<{ count: string }>(
      `select count(*)::text as count from public.grammar_patterns`,
    );

    expect(after[0].count).toBe(before[0].count);
  });
});
