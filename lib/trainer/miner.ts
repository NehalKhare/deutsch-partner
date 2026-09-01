import type { CEFRLevel } from "@/domain/cefr";
import { parseModelJson } from "@/domain/evaluation";
import {
  sessionMiningSchema,
  type AnswerAnalysis,
  type SessionMining,
} from "@/domain/trainer-analysis";
import { callSpecFor } from "@/lib/ai/gateway/call-spec";
import type {
  GatewayPrompt,
  ModelGateway,
} from "@/lib/ai/gateway/gateway";
import type { TurnBudget } from "@/lib/ai/gateway/budgeter";
import {
  behaviorPolicyFor,
  buildPrompt,
  fingerprint,
  promptEntry,
  repairInstruction,
  versionedText,
  type BuildRequest,
} from "@/lib/ai/prompts";
import { truncateToTokens } from "@/lib/ai/prompts/tokens";
import {
  newLearnerVocabulary,
  recordExposure,
  recordIncorrectUse,
} from "@/learning/vocabulary-engine";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { LearnerErrorRepository } from "@/repositories/learner-error-repository";
import type { LearnerRepository } from "@/repositories/learner-repository";
import type { MinedSessionRepository } from "@/repositories/mined-session-repository";
import type { VocabularyRepository } from "@/repositories/vocabulary-repository";

/**
 * What happens after the trainer's response has gone out.
 *
 * Two units, both scheduled with Next's after() so the learner never waits on
 * them. foldFindings writes the turn's already-validated analyzer findings
 * into the learner's recurring mistakes — no model call, and the reason the
 * next session's agenda reflects this session's slips. mineSession runs once,
 * when a session completes: one cheap model pass over the transcript tail for
 * what per-turn analysis cannot see — cross-turn patterns and vocabulary gaps.
 *
 * Every write degrades item by item, exactly like the chat pipeline's
 * post-stream nodes: one failed row costs that row, never its siblings.
 */

const PROMPT = "trainer.session_mining";

const MINING_TIMEOUT_MS = 30_000;

/** The routing document's rule, same as the evaluator: one repair, then stop. */
const MAX_MINING_REPAIRS = 1;

/** The transcript is cut to fit the task's input ceiling before it is built. */
const TRANSCRIPT_TOKENS = 3000;

/** Bounds what one mining pass may write, however chatty the model was. */
export const MAX_MINER_VOCAB_WRITES = 15;

export interface TranscriptLine {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface FoldDeps {
  readonly errors: LearnerErrorRepository;
  readonly learnerId: string;
  readonly requestId: string;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

/**
 * One turn's analyzer findings, folded into learner_errors.
 *
 * The observations are already validated — the analysis passed its schema in
 * the reply path — and the record_learner_error function merges occurrences
 * atomically, so folding the same wording twice raises a count rather than
 * duplicating a row.
 */
export async function foldFindings(
  deps: FoldDeps,
  analysis: AnswerAnalysis,
): Promise<void> {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());
  const observedAt = now();

  const observations = [
    ...analysis.findings.map((finding) => ({
      learnerId: deps.learnerId,
      errorType: finding.errorType,
      pattern: finding.note,
      utterance: finding.excerpt,
      observedAt,
    })),
    ...analysis.anglicisms.map((anglicism) => ({
      learnerId: deps.learnerId,
      errorType: "vocabulary_choice" as const,
      pattern: `Literal English phrasing: a German speaker says "${anglicism.idiomatic}"`,
      utterance: anglicism.excerpt,
      observedAt,
    })),
    ...(analysis.register.verdict === "appropriate"
      ? []
      : [
          {
            learnerId: deps.learnerId,
            errorType: "register_formality" as const,
            pattern:
              analysis.register.note ??
              "The register did not fit the exchange (du/Sie or tone)",
            observedAt,
          },
        ]),
  ];
  if (observations.length === 0) return;

  let recorded = 0;
  for (const observation of observations) {
    // Item by item: one unwritable observation costs that observation.
    const outcome = await deps.errors.record(observation).catch(() => null);
    if (outcome !== null && outcome.ok) recorded += 1;
  }

  logger.info("trainer.findings_recorded", {
    requestId: deps.requestId,
    recorded,
    of: observations.length,
  });
}

export interface MineDeps {
  readonly gateway: ModelGateway;
  readonly errors: LearnerErrorRepository;
  readonly vocabulary: VocabularyRepository;
  readonly learners: LearnerRepository;
  readonly mined: MinedSessionRepository;
  readonly learnerId: string;
  readonly requestId: string;
  readonly userIdHash: string;
  /** A fresh budget of its own: the request's is spent by the time this runs. */
  readonly budget: TurnBudget;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface MineInput {
  /** The transcript tail the completing request carried, plus its last turn. */
  readonly transcript: readonly TranscriptLine[];
  /** The session's covered subjects: the idempotency key's raw material. */
  readonly covered: readonly string[];
}

/** Derived server-side from what the session did and the day it did it. */
export function sessionKeyFor(covered: readonly string[], at: Date): string {
  const day = at.toISOString().slice(0, 10);
  return fingerprint(`${[...covered].sort().join("|")}|${day}`);
}

function miningPrompt(cefr: CEFRLevel, transcript: string): BuildRequest {
  return {
    policy: behaviorPolicyFor({ cefr }),
    cefr,
    // The mining entry declares no learner_state block; the projection is
    // required by the build request's shape and never rendered.
    learner: {
      effectiveLevel: { cefr, plus: false },
      miniLevel: 1,
      theme: "—",
      focus: "—",
      learningGoal: "—",
      interests: [],
      targetVocabulary: [],
      targetGrammar: [],
      dueVocabulary: [],
      recurringErrors: [],
      justMoved: null,
    },
    recentMessages: [],
    userMessage: transcript,
  };
}

/**
 * Mines one completed session. Claims its key first: a duplicated completion
 * turn mines nothing twice, at the price that a run killed mid-flight leaves
 * its session claimed-but-unmined — the rarer and cheaper failure, since the
 * per-turn fold has already carried the session's error signal.
 */
export async function mineSession(
  deps: MineDeps,
  input: MineInput,
): Promise<void> {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  const skip = (reason: string, audit = false) => {
    logger.info("trainer.mining_skipped", {
      requestId: deps.requestId,
      userIdHash: deps.userIdHash,
      reason,
      ...(audit ? { audit: true } : {}),
    });
  };

  const claimed = await deps.mined
    .claim(deps.learnerId, sessionKeyFor(input.covered, now()))
    .catch(() => null);
  if (claimed === null || !claimed.ok) return skip("guard_unavailable");
  if (!claimed.data) return skip("duplicate", true);

  const spec = callSpecFor("trainer.session_mining", {
    timeoutMs: MINING_TIMEOUT_MS,
    outputSchema: sessionMiningSchema,
  });
  if (!spec.ok) return skip("invalid_request");

  const state = await deps.learners.getState(deps.learnerId).catch(() => null);
  const cefr: CEFRLevel =
    state !== null && state.ok ? state.data.effectiveLevel.cefr : "A1";

  const transcript = truncateToTokens(
    input.transcript
      .map((line) => `${line.role === "user" ? "Learner" : "Trainer"}: ${line.content}`)
      .join("\n"),
    TRANSCRIPT_TOKENS,
  );

  const entry = promptEntry(PROMPT);
  let mining: SessionMining | null = null;
  let costEur = 0;
  let repair: string | null = null;

  for (let attempt = 1; attempt <= MAX_MINING_REPAIRS + 1; attempt += 1) {
    const built = buildPrompt(
      entry,
      miningPrompt(cefr, repair === null ? transcript : `${transcript}${repair}`),
    );
    if (!built.ok) return skip(built.reason);

    const prompt: GatewayPrompt = {
      system: built.prompt.system,
      user: built.prompt.user,
      inputTokens: built.prompt.tokens.total,
    };

    const outcome = await deps.gateway.complete(spec.data, prompt, {
      requestId: deps.requestId,
      userIdHash: deps.userIdHash,
      turn: deps.budget,
      prompt: {
        name: entry.name,
        version: entry.version,
        fingerprint: fingerprint(versionedText(built.prompt)),
      },
    });
    if (!outcome.ok) return skip(outcome.failure);

    costEur += outcome.data.costEur;
    const parsed = parseModelJson(outcome.data.text, sessionMiningSchema);
    if (parsed.ok) {
      mining = parsed.data;
      break;
    }

    logger.warn("trainer.mining_invalid", {
      requestId: deps.requestId,
      attempt,
      reason: parsed.reason,
      issues: parsed.issues.slice(0, 8).join(", "),
    });
    repair = repairInstruction(parsed.issues);
  }
  if (mining === null) return skip("unusable_output");

  // Recurring mistakes: straight into the aggregate, item by item.
  let errorsRecorded = 0;
  const observedAt = now();
  for (const finding of mining.recurring) {
    const outcome = await deps.errors
      .record({
        learnerId: deps.learnerId,
        errorType: finding.errorType,
        pattern: finding.pattern,
        utterance: finding.utterance,
        observedAt,
      })
      .catch(() => null);
    if (outcome !== null && outcome.ok) errorsRecorded += 1;
  }

  // Vocabulary: only catalogue words are ever tracked, the engine alone moves
  // mastery and the schedule, and a gap is a lapse — due again tomorrow.
  const lemmas = [...new Set([...mining.vocabGaps, ...mining.vocabSeen])];
  let vocabWrites = 0;
  if (lemmas.length > 0) {
    const items = await deps.vocabulary.findByLemmas(lemmas).catch(() => null);
    if (items !== null && items.ok && items.data.length > 0) {
      const existing = await deps.vocabulary
        .listByItems(deps.learnerId, items.data.map((item) => item.id))
        .catch(() => null);
      const byItem = new Map(
        existing !== null && existing.ok
          ? existing.data.map((record) => [record.vocabularyItemId, record])
          : [],
      );
      const gaps = new Set(mining.vocabGaps);

      for (const item of items.data) {
        if (vocabWrites >= MAX_MINER_VOCAB_WRITES) break;

        const record =
          byItem.get(item.id) ?? newLearnerVocabulary(deps.learnerId, item.id);
        const next = gaps.has(item.lemma)
          ? recordIncorrectUse(record, observedAt)
          : recordExposure(record, observedAt);

        const saved = await deps.vocabulary
          .upsertLearnerVocabulary(next)
          .catch(() => null);
        if (saved !== null && saved.ok) vocabWrites += 1;
      }
    }
  }

  logger.info("trainer.mining_completed", {
    requestId: deps.requestId,
    userIdHash: deps.userIdHash,
    errorsRecorded,
    vocabWrites,
    costEur: Number(costEur.toFixed(8)),
  });
}
