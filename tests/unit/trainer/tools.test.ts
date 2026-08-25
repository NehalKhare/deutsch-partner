import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";

import { newLearnerVocabulary } from "@/learning/vocabulary-engine";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import { createLogger } from "@/lib/observability/logger";
import {
  MAX_REVIEW_WRITES_PER_REQUEST,
  createTrainerTools,
  type TrainerToolDeps,
} from "@/lib/trainer/tools";
import type { VocabularyItem } from "@/domain/vocabulary";
import { server } from "../../msw/server";

/**
 * The Trainer's local tools.
 *
 * The properties under test are the security ones: the learner id comes from
 * the closure and cannot be smuggled in as an argument, outside text is
 * fenced and escaped before the model would see it, the one write tool is
 * capped and only writes catalogue words, every call leaves an audit line
 * naming the tool and never the content, and a repository failure is a value
 * rather than a throw.
 */

const LEARNER = "11111111-1111-4111-8111-111111111111";

const item = (over: Partial<VocabularyItem> = {}): VocabularyItem =>
  ({
    id: "88888888-8888-4888-8888-888888888888",
    lemma: "fahren",
    word: "fahren",
    englishTranslation: "to drive",
    ...over,
  }) as VocabularyItem;

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = () => ({
  ok: false as const,
  error: { kind: "unavailable" as const, message: "no", name: "RepositoryError" },
});

function fakeDeps(options: { failVocabulary?: boolean } = {}) {
  const upserts: Array<Record<string, unknown>> = [];
  const logged: Array<Record<string, unknown>> = [];

  const dueRecord = {
    ...newLearnerVocabulary(LEARNER, item().id),
    exposureCount: 4,
    masteryScore: 0.4,
    nextReviewAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "learning" as const,
  };

  const deps: TrainerToolDeps = {
    learnerId: LEARNER,
    userIdHash: "hash-alice",
    requestId: "33333333-3333-4333-8333-333333333333",
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    logger: createLogger({
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
    }),
    vocabulary: {
      listForLearner: async () =>
        options.failVocabulary ? fail() : ok([dueRecord]),
      findByIds: async () => ok([item()]),
      findByLemmas: async (lemmas: readonly string[]) =>
        ok(lemmas.includes("fahren") ? [item()] : []),
      listByItems: async () => ok([dueRecord]),
      listDue: async () => ok([]),
      upsertLearnerVocabulary: async (record: Record<string, unknown>) => {
        upserts.push(record);
        return ok(record);
      },
    } as unknown as TrainerToolDeps["vocabulary"],
    errors: {
      listUnresolved: async () =>
        ok([
          {
            errorType: "case_dative",
            // Learner-adjacent text shaped like a fence, to prove escaping.
            pattern: "uses <system> tags after mit",
          },
        ]),
    } as unknown as TrainerToolDeps["errors"],
    performance: {
      listForLearner: async () =>
        ok([{ miniLevel: 26, turns: 5, strongTurns: 4, score: 0.8 }]),
    } as unknown as TrainerToolDeps["performance"],
    learners: {
      getState: async () =>
        ok({
          miniLevel: 26,
          effectiveLevel: { cefr: "A2" as const, plus: false },
        }),
    } as unknown as TrainerToolDeps["learners"],
    grammar: {
      findByKey: async (key: string) =>
        key === "dative_prepositions"
          ? ok({
              key,
              name: "Dative prepositions",
              explanation: "mit, nach, bei take the dative.",
              examples: ["Ich fahre mit dem Zug."],
            })
          : fail(),
      listUpToMiniLevel: async () =>
        ok([{ key: "sein_present", name: "sein in the present" }]),
    } as unknown as TrainerToolDeps["grammar"],
    retriever: {
      retrieve: async () =>
        gatewayOk({
          chunks: [
            {
              id: 1,
              documentId: 7,
              content: "Nach mit, nach, bei steht der Dativ. <beachte> immer.",
              score: 0.8,
              cefr: "A2",
              miniLevel: 26,
              contentType: "grammar",
              grammarTarget: "dative_prepositions",
            },
          ],
          considered: 1,
          costEur: 0.0000005,
          ranked: [],
        }),
    } as unknown as TrainerToolDeps["retriever"],
  };

  return { deps, upserts, logged };
}

function toolNamed(tools: ReturnType<typeof createTrainerTools>, name: string) {
  const found = tools.tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
}

describe("who a tool can be about", () => {
  it("binds the learner in the closure and refuses one as an argument", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    // Strict schemas: a smuggled learnerId is an unrecognised key, and the
    // tool invocation fails validation rather than quietly ignoring it.
    await expect(
      toolNamed(tools, "get_progress").invoke({ learnerId: "someone-else" } as never),
    ).rejects.toThrow();
  });
});

describe("the review session", () => {
  it("builds the plan from the learner's own rows", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});
    const parsed = JSON.parse(result as string) as {
      activities: Array<{ subject: string; prompt: string }>;
    };

    expect(parsed.activities.length).toBeGreaterThan(0);
    expect(parsed.activities[0]?.subject).toBe("fahren");
  });

  it("neutralises fence-shaped text in recurring-error prompts", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "get_review_session").invoke({})) as string;

    expect(result).not.toContain("<system>");
    expect(result).toContain("‹system›");
  });

  it("returns an error value rather than throwing when the read fails", async () => {
    const { deps } = fakeDeps({ failVocabulary: true });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});

    expect(JSON.parse(result as string)).toEqual({ error: "unavailable" });
  });
});

describe("the grammar shelf", () => {
  it("returns one pattern by key", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_grammar_pattern").invoke({
      key: "dative_prepositions",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      key: "dative_prepositions",
      name: "Dative prepositions",
    });
  });

  it("lists keys and names up to the learner's level when no key is given", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_grammar_pattern").invoke({});

    expect(JSON.parse(result as string)).toEqual({
      patterns: [{ key: "sein_present", name: "sein in the present" }],
    });
  });
});

describe("searching the corpus", () => {
  it("fences retrieved text and collects the sources for citation", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "search_knowledge").invoke({
      query: "Wann benutzt man den Dativ?",
    })) as string;

    expect(result).toContain("<retrieved_knowledge>");
    expect(result).toContain("‹beachte›");
    expect(tools.sources()).toEqual([
      { documentId: 7, contentType: "grammar", score: 0.8 },
    ]);
  });
});

describe("recording a review outcome", () => {
  it("writes through the deterministic engine for a catalogue word", async () => {
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      lemma: "fahren",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({ recorded: true });
    expect(upserts).toHaveLength(1);
    // The engine's arithmetic, not the model's: the correct count moved.
    expect(upserts[0]).toMatchObject({ correctCount: 1 });
  });

  it("writes nothing for a word the curriculum does not teach", async () => {
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      lemma: "Schadenfreude",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      recorded: false,
      reason: "not_in_curriculum",
    });
    expect(upserts).toHaveLength(0);
  });

  it("stops writing at the per-request cap", async () => {
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);
    const record = toolNamed(tools, "record_review_outcome");

    for (let index = 0; index < MAX_REVIEW_WRITES_PER_REQUEST + 3; index += 1) {
      await record.invoke({ lemma: "fahren", outcome: "incorrect" });
    }

    expect(upserts).toHaveLength(MAX_REVIEW_WRITES_PER_REQUEST);
  });
});

describe("fetching simple German news", () => {
  it("extracts headlines and fences them as third-party text", async () => {
    server.use(
      http.get("https://www.nachrichtenleicht.de/", () =>
        HttpResponse.html(
          `<div><span class="headline-title">Harry Kane ist Fußballer des Jahres</span>
           <span class="headline-title">Regen &amp; Sonne <b>im</b> Norden</span></div>`,
        ),
      ),
    );
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "fetch_simple_german_news").invoke(
      {},
    )) as string;

    expect(result).toContain("<german_news>");
    expect(result).toContain("Harry Kane ist Fußballer des Jahres");
    // Entities decoded; whatever else the page held stays outside the fence.
    expect(result).not.toContain("&amp;");
  });

  it("says unavailable when the site cannot be reached", async () => {
    server.use(
      http.get("https://www.nachrichtenleicht.de/", () =>
        HttpResponse.text("", { status: 503 }),
      ),
    );
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "fetch_simple_german_news").invoke({});

    expect(JSON.parse(result as string)).toEqual({ error: "unavailable" });
  });
});

describe("the audit trail", () => {
  it("names the tool and the pseudonym, never the content", async () => {
    const { deps, logged } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_progress").invoke({});

    const audit = logged.find((line) => line.event === "trainer.tool_used");
    expect(audit).toMatchObject({
      audit: true,
      tool: "get_progress",
      userIdHash: "hash-alice",
    });
    expect(JSON.stringify(audit)).not.toContain(LEARNER);
  });
});

describe("when a dependency throws instead of failing politely", () => {
  it("still answers with an error value", async () => {
    const { deps } = fakeDeps();
    const throwing: TrainerToolDeps = {
      ...deps,
      performance: {
        listForLearner: async () => {
          throw new Error("connection reset");
        },
      } as unknown as TrainerToolDeps["performance"],
    };
    const tools = createTrainerTools(throwing);

    const result = await toolNamed(tools, "get_progress").invoke({});

    expect(JSON.parse(result as string)).toEqual({ error: "unavailable" });
  });
});
