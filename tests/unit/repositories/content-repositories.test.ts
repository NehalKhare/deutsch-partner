import { describe, expect, it } from "vitest";

import { createAssessmentRepository } from "@/repositories/assessment-repository";
import { createGrammarRepository } from "@/repositories/grammar-repository";
import { createKnowledgeRepository } from "@/repositories/knowledge-repository";
import { createMemoryRepository } from "@/repositories/memory-repository";
import { createVocabularyRepository } from "@/repositories/vocabulary-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

const vocabRow = {
  id: ITEM,
  lemma: "Zug",
  word: "der Zug",
  part_of_speech: "noun",
  gender: "der",
  plural: "Züge",
  english_translation: "train",
  german_definition: "Ein Fahrzeug auf Schienen.",
  example: "Ich fahre mit dem Zug.",
  collocations: [],
  common_mistakes: [],
  cefr: "A1",
  mini_level: 8,
  topic: "travel",
  frequency_band: 2,
  is_core_word: true,
};

const progressRow = {
  learner_id: LEARNER,
  vocabulary_item_id: ITEM,
  exposure_count: 12,
  correct_count: 3,
  incorrect_count: 9,
  mastery_score: "0.200",
  confidence: "0.300",
  last_seen_at: "2026-08-20T10:00:00.000Z",
  next_review_at: "2026-08-22T10:00:00.000Z",
  status: "weak",
};

describe("VocabularyRepository", () => {
  it("looks items up by lemma", async () => {
    const fake = createFakeSupabase({ vocabulary_items: { data: [vocabRow] } });

    const result = await createVocabularyRepository(fake.client).findByLemmas([
      "Zug",
    ]);

    expect(result.ok && result.data[0]?.lemma).toBe("Zug");
    expect(fake.methodArgs("vocabulary_items", "in")).toEqual([
      ["lemma", ["Zug"]],
    ]);
  });

  it("looks a word up by id for a review session", async () => {
    const fake = createFakeSupabase({ vocabulary_items: { data: [vocabRow] } });

    const result = await createVocabularyRepository(fake.client).findByIds([ITEM]);

    expect(result.ok && result.data[0]?.id).toBe(ITEM);
    expect(fake.methodArgs("vocabulary_items", "in")).toEqual([["id", [ITEM]]]);
  });

  it("does not query at all for an empty id list", async () => {
    const fake = createFakeSupabase({ vocabulary_items: { data: [] } });

    const result = await createVocabularyRepository(fake.client).findByIds([]);

    expect(result).toEqual({ ok: true, data: [] });
    expect(fake.calls).toEqual([]);
  });

  it("does not query at all for an empty lemma list", async () => {
    const fake = createFakeSupabase({ vocabulary_items: { data: [] } });

    const result = await createVocabularyRepository(fake.client).findByLemmas([]);

    expect(result).toEqual({ ok: true, data: [] });
    expect(fake.calls).toEqual([]);
  });

  it("converts numeric columns returned as strings", async () => {
    const fake = createFakeSupabase({ learner_vocabulary: { data: [progressRow] } });

    const result = await createVocabularyRepository(fake.client).listDue(
      LEARNER,
      new Date("2026-08-23T00:00:00.000Z"),
      20,
    );

    expect(result.ok && result.data[0]?.masteryScore).toBe(0.2);
  });

  it("asks only for words actually due for review", async () => {
    const fake = createFakeSupabase({ learner_vocabulary: { data: [] } });
    const now = new Date("2026-08-23T00:00:00.000Z");

    await createVocabularyRepository(fake.client).listDue(LEARNER, now, 20);

    expect(fake.methodArgs("learner_vocabulary", "lte")).toEqual([
      ["next_review_at", now.toISOString()],
    ]);
    expect(fake.methodArgs("learner_vocabulary", "neq")).toEqual([
      ["status", "mastered"],
    ]);
  });

  it("validates progress before writing it", async () => {
    const fake = createFakeSupabase({ learner_vocabulary: { data: progressRow } });

    const result = await createVocabularyRepository(
      fake.client,
    ).upsertLearnerVocabulary({
      learnerId: LEARNER,
      vocabularyItemId: ITEM,
      exposureCount: 2,
      correctCount: 5,
      incorrectCount: 5,
      masteryScore: 0.2,
      confidence: 0.3,
      lastSeenAt: null,
      nextReviewAt: null,
      status: "weak",
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });
});

describe("GrammarRepository", () => {
  const patternRow = {
    id: "44444444-4444-4444-8444-444444444444",
    key: "dative_after_mit",
    name: "Dative after mit",
    explanation: "mit takes the dative.",
    examples: ["Ich fahre mit dem Zug."],
    cefr: "A2",
    mini_level: 22,
    difficulty: 3,
    common_mistakes: [],
    related_pattern_keys: [],
    category: "grammar",
  };

  it("finds a pattern by its stable key", async () => {
    const fake = createFakeSupabase({ grammar_patterns: { data: patternRow } });

    const result = await createGrammarRepository(fake.client).findByKey(
      "dative_after_mit",
    );

    expect(result.ok && result.data.name).toBe("Dative after mit");
    expect(fake.methodArgs("grammar_patterns", "eq")).toEqual([
      ["key", "dative_after_mit"],
    ]);
  });

  it("lists patterns at or below a mini-level", async () => {
    const fake = createFakeSupabase({ grammar_patterns: { data: [patternRow] } });

    await createGrammarRepository(fake.client).listUpToMiniLevel(30);

    expect(fake.methodArgs("grammar_patterns", "lte")).toEqual([
      ["mini_level", 30],
    ]);
  });

  it("refuses an out-of-range mini-level without querying", async () => {
    const fake = createFakeSupabase({ grammar_patterns: { data: [] } });

    const result = await createGrammarRepository(fake.client).listUpToMiniLevel(
      99,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });
});

describe("MemoryRepository", () => {
  const memoryRow = {
    id: "77777777-7777-4777-8777-777777777777",
    learner_id: LEARNER,
    kind: "interest",
    content: "Enjoys cycling",
    salience: "0.700",
    learner_error_id: null,
    created_at: "2026-08-20T10:00:00.000Z",
  };

  it("lists memories by salience", async () => {
    const fake = createFakeSupabase({ learner_memories: { data: [memoryRow] } });

    const result = await createMemoryRepository(fake.client).listForLearner(
      LEARNER,
      10,
    );

    expect(result.ok && result.data[0]?.kind).toBe("interest");
    expect(fake.methodArgs("learner_memories", "order")[0]?.[0]).toBe("salience");
  });

  it("refuses to store a credential as a memory", async () => {
    // The extraction prompt is told not to propose these. This is the
    // independent check that does not trust it.
    const fake = createFakeSupabase({ learner_memories: { data: memoryRow } });

    const result = await createMemoryRepository(fake.client).insert({
      id: memoryRow.id,
      learnerId: LEARNER,
      kind: "fact",
      content: "My password is hunter2",
      salience: 0.9,
      createdAt: new Date(),
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });

  it("stores an ordinary memory", async () => {
    const fake = createFakeSupabase({ learner_memories: { data: memoryRow } });

    const result = await createMemoryRepository(fake.client).insert({
      id: memoryRow.id,
      learnerId: LEARNER,
      kind: "interest",
      content: "Enjoys cycling",
      salience: 0.7,
      createdAt: new Date(memoryRow.created_at),
    });

    expect(result.ok).toBe(true);
  });
});

describe("KnowledgeRepository", () => {
  it("finds a document by its content hash, for idempotent ingestion", async () => {
    const fake = createFakeSupabase({
      knowledge_documents: { data: { id: 1, content_hash: "abc" } },
    });

    const result = await createKnowledgeRepository(fake.client).findDocumentByHash(
      "abc",
    );

    expect(result.ok && result.data?.id).toBe(1);
    expect(fake.methodArgs("knowledge_documents", "eq")).toEqual([
      ["content_hash", "abc"],
    ]);
  });

  it("reports an absent document as null rather than as an error", async () => {
    const fake = createFakeSupabase({ knowledge_documents: { data: null } });

    const result = await createKnowledgeRepository(fake.client).findDocumentByHash(
      "missing",
    );

    expect(result).toEqual({ ok: true, data: null });
  });

  it("filters retrieval candidates by the learner's level", async () => {
    const fake = createFakeSupabase({ knowledge_chunks: { data: [] } });

    await createKnowledgeRepository(fake.client).findChunks({
      cefr: "A2",
      contentType: "grammar",
      limit: 6,
    });

    expect(fake.methodArgs("knowledge_chunks", "eq")).toEqual([
      ["cefr", "A2"],
      ["content_type", "grammar"],
    ]);
    expect(fake.methodArgs("knowledge_chunks", "limit")).toEqual([[6]]);
  });
});

describe("AssessmentRepository", () => {
  const assessmentRow = {
    id: "99999999-9999-4999-8999-999999999999",
    learner_id: LEARNER,
    kind: "onboarding",
    mini_level: null,
    estimated_cefr: "A1",
    score: "0.550",
    passed: null,
    detail: {},
    created_at: "2026-08-20T10:00:00.000Z",
  };

  it("records an assessment", async () => {
    const fake = createFakeSupabase({ assessments: { data: assessmentRow } });

    const result = await createAssessmentRepository(fake.client).record({
      learnerId: LEARNER,
      kind: "onboarding",
      estimatedCefr: "A1",
      score: 0.55,
    });

    expect(result.ok).toBe(true);
    const [[payload]] = fake.methodArgs("assessments", "insert");
    expect(payload).toMatchObject({ learner_id: LEARNER, kind: "onboarding" });
  });

  it("rejects an unknown assessment kind", async () => {
    const fake = createFakeSupabase({ assessments: { data: assessmentRow } });

    const result = await createAssessmentRepository(fake.client).record({
      learnerId: LEARNER,
      kind: "goethe_certificate",
      score: 1,
    } as never);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });

  it("returns the most recent assessments first", async () => {
    const fake = createFakeSupabase({ assessments: { data: [assessmentRow] } });

    await createAssessmentRepository(fake.client).listForLearner(LEARNER, 5);

    const [column, options] = fake.methodArgs("assessments", "order")[0] as [
      string,
      { ascending?: boolean },
    ];
    expect(column).toBe("created_at");
    expect(options?.ascending).toBe(false);
  });
});
