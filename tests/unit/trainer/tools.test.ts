import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";

import { newLearnerVocabulary } from "@/learning/vocabulary-engine";
import { gatewayOk } from "@/lib/ai/gateway/errors";
import { createLogger } from "@/lib/observability/logger";
import { NEWS_RETELL_WORDS } from "@/lib/trainer/news";
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
const TABLE_ID = "99999999-9999-4999-8999-999999999999";
const ERROR_ID = "77777777-7777-4777-8777-777777777777";

const item = (over: Partial<VocabularyItem> = {}): VocabularyItem =>
  ({
    id: "88888888-8888-4888-8888-888888888888",
    lemma: "fahren",
    word: "fahren",
    englishTranslation: "to drive",
    ...over,
  }) as VocabularyItem;

/** The two words this file's learner has ever met. */
const CATALOGUE = [
  item(),
  item({
    id: TABLE_ID,
    lemma: "Tisch",
    word: "der Tisch",
    englishTranslation: "the table",
  }),
];

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = () => ({
  ok: false as const,
  error: { kind: "unavailable" as const, message: "no", name: "RepositoryError" },
});

function fakeDeps(
  options: {
    failVocabulary?: boolean;
    noVocabulary?: boolean;
    noErrors?: boolean;
    noGrammar?: boolean;
    /** Puts the learner on mini-level 27, whose curriculum has a culture note. */
    cultureLevel?: boolean;
    cefr?: "A1" | "A2" | "B1";
    covered?: readonly string[];
  } = {},
) {
  const upserts: Array<Record<string, unknown>> = [];
  const logged: Array<Record<string, unknown>> = [];
  const resolved: string[] = [];

  const dueRecord = {
    ...newLearnerVocabulary(LEARNER, item().id),
    exposureCount: 4,
    masteryScore: 0.4,
    nextReviewAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "learning" as const,
  };

  const deps: TrainerToolDeps = {
    learnerId: LEARNER,
    covered: options.covered ?? [],
    userIdHash: "hash-alice",
    requestId: "33333333-3333-4333-8333-333333333333",
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    logger: createLogger({
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
    }),
    vocabulary: {
      listForLearner: async () =>
        options.failVocabulary ? fail() : ok(options.noVocabulary ? [] : [dueRecord]),
      findByIds: async () => ok([item()]),
      findByLemmas: async (lemmas: readonly string[]) =>
        ok(CATALOGUE.filter((row) => lemmas.includes(row.lemma))),
      listByItems: async () => ok([dueRecord]),
      listDue: async () => ok([]),
      upsertLearnerVocabulary: async (record: Record<string, unknown>) => {
        upserts.push(record);
        return ok(record);
      },
    } as unknown as TrainerToolDeps["vocabulary"],
    errors: {
      listUnresolved: async () =>
        options.noErrors
          ? ok([])
          : ok([
              {
                id: ERROR_ID,
                errorType: "case_dative",
                // Learner-adjacent text shaped like a fence, to prove escaping.
                pattern: "uses <system> tags after mit",
              },
            ]),
      markResolved: async (errorId: string) => {
        resolved.push(errorId);
        return ok({ id: errorId, resolved: true });
      },
    } as unknown as TrainerToolDeps["errors"],
    performance: {
      listForLearner: async () =>
        ok([{ miniLevel: 26, turns: 5, strongTurns: 4, score: 0.8 }]),
    } as unknown as TrainerToolDeps["performance"],
    learners: {
      getState: async () =>
        ok({
          miniLevel: options.cultureLevel ? 27 : 26,
          effectiveLevel: { cefr: options.cefr ?? "A2", plus: false },
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
      // Echoes the first key it was asked for, so the one drill this learner
      // gets always belongs to whatever their level's target grammar is —
      // plus, on the culture level, the note that level teaches.
      findByKeys: async (keys: readonly string[]) =>
        options.noGrammar
          ? ok([])
          : ok([
              ...keys.slice(0, 1).map((key) => ({
                key,
                name: "Dative prepositions",
                explanation: "mit, nach, bei take the dative.",
                examples: ["Ich fahre mit dem Zug."],
                category: "grammar",
              })),
              ...(options.cultureLevel && keys.includes("reklamieren_mit_stil")
                ? [
                    {
                      key: "reklamieren_mit_stil",
                      name: "Firm but polite complaint",
                      explanation:
                        "Name the problem plainly; the politeness sits in the Konjunktiv.",
                      examples: ["Ich möchte die Jacke umtauschen."],
                      category: "culture",
                    },
                  ]
                : []),
            ]),
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

  return { deps, upserts, logged, resolved };
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

describe("the session agenda", () => {
  it("lists everything the session will cover and hands over only the next item", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});
    const parsed = JSON.parse(result as string) as {
      completed: number;
      remaining: number;
      agenda: Array<{ position: number; kind: string; subject: string }>;
      next: { subject: string; prompt: string } | null;
    };

    // The whole list, so the trainer can read it out before the first
    // question — and no prompts in it, because an agenda with the questions
    // printed underneath is a quiz the learner can read ahead of.
    expect(parsed.agenda.map((line) => line.subject)).toEqual([
      "fahren",
      // The label a learner hears, never the error-type key.
      "The dative case",
      // The level's own grammar, drilled even though nothing went wrong.
      "Dative prepositions",
      "Nachrichten von heute",
    ]);
    expect(JSON.stringify(parsed.agenda)).not.toContain("prompt");
    expect(parsed.completed).toBe(0);
    expect(parsed.remaining).toBe(4);
    expect(parsed.next).toMatchObject({
      subject: "fahren",
      prompt: 'What is the German for "to drive"?',
    });
  });

  it("hands a mistake over as background, never as a ready question", async () => {
    const { deps } = fakeDeps({ covered: ["fahren"] });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});
    const parsed = JSON.parse(result as string) as {
      next: { subject: string; prompt?: string; struggles?: string } | null;
    };

    // The note describes what keeps going wrong; a field called "prompt"
    // would be read out as the exercise, which is exactly what happened.
    expect(parsed.next?.subject).toBe("The dative case");
    expect(parsed.next?.prompt).toBeUndefined();
    expect(parsed.next?.struggles).toContain("after mit");
    // And the fence shape inside it arrives defused.
    expect(parsed.next?.struggles).not.toContain("<system>");
  });

  it("leaves out what this session already covered", async () => {
    const { deps } = fakeDeps({ covered: ["fahren"] });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});
    const parsed = JSON.parse(result as string) as {
      completed: number;
      agenda: Array<{ subject: string }>;
      next: { subject: string } | null;
    };

    expect(parsed.agenda.map((line) => line.subject)).toEqual([
      "The dative case",
      "Dative prepositions",
      "Nachrichten von heute",
    ]);
    expect(parsed.completed).toBe(1);
    expect(parsed.next?.subject).toBe("The dative case");
  });

  it("has nothing left to ask once the whole agenda is covered", async () => {
    const { deps } = fakeDeps({
      covered: [
        "fahren",
        "The dative case",
        "Dative prepositions",
        "Nachrichten von heute",
      ],
    });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});

    expect(JSON.parse(result as string)).toMatchObject({
      remaining: 0,
      agenda: [],
      next: null,
      sessionComplete: true,
    });
    expect(tools.complete()).toBe(true);
  });

  it("ends with what to recall, read back out of the catalogue", async () => {
    const { deps } = fakeDeps({
      covered: [
        "fahren",
        "The dative case",
        "Dative prepositions",
        "der Tisch",
        "Nachrichten von heute",
      ],
    });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});

    // The words and meanings are the database's, not the client's keys and
    // not the model's memory of a transcript.
    expect(JSON.parse(result as string).recap).toEqual([
      { subject: "fahren", meaning: "to drive" },
      { subject: "der Tisch", meaning: "the table" },
    ]);
  });

  it("recaps only what it can look up, and invents nothing", async () => {
    const { deps } = fakeDeps({
      covered: [
        "The dative case",
        "Dative prepositions",
        "fahren",
        "Nachrichten von heute",
      ],
    });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});

    // A recurring-error subject is not a catalogue word; it is left out
    // rather than given a meaning nobody looked up.
    expect(JSON.parse(result as string).recap).toEqual([
      { subject: "fahren", meaning: "to drive" },
    ]);
  });

  it("is not a finished session when there was never anything to do", async () => {
    // Nothing due and nothing gone wrong: the session is not over, it still
    // has grammar and reading in it, and "your session is over" is a strange
    // hello.
    const { deps } = fakeDeps({ noVocabulary: true, noErrors: true });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});

    expect(JSON.parse(result as string)).toMatchObject({
      remaining: 2,
      sessionComplete: false,
      next: { subject: "Dative prepositions" },
    });
    expect(JSON.parse(result as string).recap).toBeUndefined();
    expect(tools.complete()).toBe(false);
  });

  it("always ends the agenda on something real to read", async () => {
    const { deps } = fakeDeps({ noVocabulary: true, noErrors: true });
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});

    expect(tools.agenda()?.at(-1)).toEqual({
      kind: "read_the_news",
      subject: "Nachrichten von heute",
    });
  });

  it("still has something to read when the grammar shelf is empty too", async () => {
    const { deps } = fakeDeps({
      noVocabulary: true,
      noErrors: true,
      noGrammar: true,
    });
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});

    expect(tools.agenda()).toEqual([
      { kind: "read_the_news", subject: "Nachrichten von heute" },
    ]);
  });

  it("reports the agenda it built, for the session to show", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});

    // A mix, not a queue: the vocabulary, the mistake, the level's grammar,
    // and the reading item last.
    expect(tools.agenda()).toEqual([
      { kind: "recall", subject: "fahren" },
      { kind: "correct_the_mistake", subject: "The dative case" },
      { kind: "grammar_drill", subject: "Dative prepositions" },
      { kind: "read_the_news", subject: "Nachrichten von heute" },
    ]);
  });

  it("hands a grammar drill over as a rule to teach, with its pattern key", async () => {
    const { deps } = fakeDeps({ covered: ["fahren", "The dative case"] });
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "get_review_session").invoke({});
    const parsed = JSON.parse(result as string) as {
      next: {
        subject: string;
        kind: string;
        prompt?: string;
        struggles?: string;
        teach?: string;
        pattern?: string;
      } | null;
    };

    // The rule is background to teach from, not a question to read out, and
    // the key is there for get_grammar_pattern if the trainer wants examples.
    expect(parsed.next?.kind).toBe("grammar_drill");
    expect(parsed.next?.subject).toBe("Dative prepositions");
    expect(parsed.next?.prompt).toBeUndefined();
    expect(parsed.next?.struggles).toBeUndefined();
    expect(parsed.next?.teach).toContain("dative");
    expect(parsed.next?.pattern).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("reports no agenda at all when it was never asked for one", () => {
    const { deps } = fakeDeps();

    expect(createTrainerTools(deps).agenda()).toBeNull();
  });

  it("neutralises fence-shaped text in the item it hands over", async () => {
    const { deps } = fakeDeps({ covered: ["fahren"] });
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "get_review_session").invoke({})) as string;

    expect(result).not.toContain("<system>");
    expect(result).toContain("\u2039system\u203a");
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
      subject: "fahren",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({ recorded: true });
    expect(upserts).toHaveLength(1);
    // The engine's arithmetic, not the model's: the correct count moved.
    expect(upserts[0]).toMatchObject({ correctCount: 1 });
  });

  it("resolves an agenda subject that carries its article", async () => {
    // The agenda says "der Tisch" because that is what a learner should read;
    // the progress row is keyed by the lemma. The model should not have to
    // know the difference.
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "der Tisch",
      outcome: "incorrect",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      recorded: true,
      subject: "der Tisch",
    });
    expect(upserts).toHaveLength(1);
  });

  it("closes the item, so the agenda moves on to the next one", async () => {
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "record_review_outcome").invoke({
      subject: "fahren",
      outcome: "correct",
    });
    const result = await toolNamed(tools, "get_review_session").invoke({});

    expect(JSON.parse(result as string)).toMatchObject({
      completed: 1,
      next: { subject: "The dative case" },
    });
    expect(tools.covered()).toContain("fahren");
  });

  it("writes nothing for a subject the curriculum does not teach, but still closes it", async () => {
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "case_dative",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      recorded: false,
      reason: "not_in_curriculum",
      closed: true,
    });
    expect(upserts).toHaveLength(0);
    expect(tools.covered()).toEqual(["case_dative"]);
  });

  it("carries the session's earlier subjects forward", async () => {
    const { deps } = fakeDeps({ covered: ["der Bahnhof"] });
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "record_review_outcome").invoke({
      subject: "fahren",
      outcome: "correct",
    });

    expect(tools.covered()).toEqual(["der Bahnhof", "fahren"]);
  });

  it("marks a recurring mistake fixed when the learner corrects it", async () => {
    const { deps, resolved } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});
    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "The dative case",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      resolved: true,
      closed: true,
    });
    expect(resolved).toEqual([ERROR_ID]);
    expect(tools.covered()).toContain("The dative case");
  });

  it("leaves a mistake unresolved when the learner did not fix it", async () => {
    const { deps, resolved } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});
    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "The dative case",
      outcome: "incorrect",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      recorded: false,
      reason: "mistake_not_yet_fixed",
      closed: true,
    });
    expect(resolved).toEqual([]);
    // Unresolved in the database — a later session lists it again — but
    // closed for this sitting: leaving it open re-served the same mistake
    // to a learner who had just been told it would come back another day.
    expect(tools.covered()).toContain("The dative case");
  });

  it("resolves a fixed mistake even when this turn never planned an agenda", async () => {
    // The answer usually lands a turn after the question, and that turn may
    // record before it plans. Whether a mistake gets resolved must not depend
    // on tool-call order inside one request.
    const { deps, resolved } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "The dative case",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({ resolved: true, closed: true });
    expect(resolved).toEqual([ERROR_ID]);
  });

  it("closes a practised grammar drill without inventing a progress row", async () => {
    const { deps, upserts, resolved } = fakeDeps();
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});
    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "Dative prepositions",
      outcome: "correct",
    });

    // A drill has no schedule behind it: nothing written, nothing resolved,
    // and the item closed so the session moves on.
    expect(JSON.parse(result as string)).toMatchObject({
      recorded: false,
      reason: "grammar_practised",
      closed: true,
    });
    expect(upserts).toHaveLength(0);
    expect(resolved).toEqual([]);
    expect(tools.covered()).toContain("Dative prepositions");
  });

  it("closes a grammar drill even when this turn never planned an agenda", async () => {
    // The answer usually lands a turn after the question, in a request whose
    // key map is empty. The level's own patterns are the fallback.
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "Dative prepositions",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      reason: "grammar_practised",
      closed: true,
    });
    expect(upserts).toHaveLength(0);
  });

  it("stops writing at the per-request cap", async () => {
    const { deps, upserts } = fakeDeps();
    const tools = createTrainerTools(deps);
    const record = toolNamed(tools, "record_review_outcome");

    for (let index = 0; index < MAX_REVIEW_WRITES_PER_REQUEST + 3; index += 1) {
      await record.invoke({ subject: "fahren", outcome: "incorrect" });
    }

    expect(upserts).toHaveLength(MAX_REVIEW_WRITES_PER_REQUEST);
  });
});

describe("fetching simple German news", () => {
  const page = (...headlines: string[]) =>
    headlines
      .map((headline) => `<span class="headline-title">${headline}</span>`)
      .join("\n");

  it("fences the headlines and frames them as a task at the learner's level", async () => {
    server.use(
      http.get("https://www.nachrichtenleicht.de/", () =>
        HttpResponse.html(
          page(
            "Die Regierung berät heute lange über den Haushalt für das Jahr",
            "Regen &amp; Sonne im Norden",
          ),
        ),
      ),
    );
    const { deps } = fakeDeps();
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "fetch_simple_german_news").invoke(
      {},
    )) as string;

    // Somebody else's words, inside the fence.
    expect(result).toContain("<german_news>");
    expect(result).toContain("Regen & Sonne im Norden");
    expect(result).not.toContain("&amp;");
    // The instruction, outside it, carrying this learner's level and budget.
    expect(result).toContain("level A2");
    expect(result).toContain(`${NEWS_RETELL_WORDS.A2} words`);
    // Shortest first, so the item the trainer reaches for is the kind one.
    expect(result.indexOf("Regen")).toBeLessThan(result.indexOf("Die Regierung"));
  });

  it("asks a beginner for a shorter sentence than a B1 reader", async () => {
    server.use(
      http.get("https://www.nachrichtenleicht.de/", () =>
        HttpResponse.html(page("Es regnet heute")),
      ),
    );
    const { deps } = fakeDeps({ cefr: "A1" });
    const tools = createTrainerTools(deps);

    const result = (await toolNamed(tools, "fetch_simple_german_news").invoke(
      {},
    )) as string;

    expect(result).toContain("level A1");
    expect(result).toContain(`${NEWS_RETELL_WORDS.A1} words`);
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

describe("the culture note on the agenda", () => {
  it("appears as its own kind, after grammar and before the news", async () => {
    const { deps } = fakeDeps({ cultureLevel: true });
    const tools = createTrainerTools(deps);

    const result = JSON.parse(
      (await toolNamed(tools, "get_review_session").invoke({})) as string,
    ) as { agenda: Array<{ kind: string; subject: string }> };

    const kinds = result.agenda.map((line) => line.kind);
    expect(kinds).toContain("culture_drill");
    expect(kinds.indexOf("culture_drill")).toBeGreaterThan(
      kinds.indexOf("grammar_drill"),
    );
    expect(kinds.at(-1)).toBe("read_the_news");
  });

  it("arrives as teach, with the key that opens get_grammar_pattern", async () => {
    const { deps } = fakeDeps({
      cultureLevel: true,
      covered: ["fahren", "The dative case", "Dative prepositions"],
    });
    const tools = createTrainerTools(deps);

    const result = JSON.parse(
      (await toolNamed(tools, "get_review_session").invoke({})) as string,
    ) as { next: Record<string, unknown> };

    expect(result.next).toMatchObject({
      kind: "culture_drill",
      subject: "Firm but polite complaint",
      pattern: "reklamieren_mit_stil",
    });
    expect(String(result.next.teach)).toContain("Konjunktiv");
    // Background for the trainer to teach from, never a ready-made question.
    expect(result.next.prompt).toBeUndefined();
  });

  it("closes without a write, exactly like a grammar drill", async () => {
    const { deps, upserts, resolved } = fakeDeps({ cultureLevel: true });
    const tools = createTrainerTools(deps);

    await toolNamed(tools, "get_review_session").invoke({});
    const result = await toolNamed(tools, "record_review_outcome").invoke({
      subject: "Firm but polite complaint",
      outcome: "correct",
    });

    expect(JSON.parse(result as string)).toMatchObject({
      recorded: false,
      reason: "grammar_practised",
      closed: true,
    });
    expect(upserts).toHaveLength(0);
    expect(resolved).toEqual([]);
    expect(tools.covered()).toContain("Firm but polite complaint");
  });
});
