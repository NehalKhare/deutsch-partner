import { z } from "zod";

import { PLAN_CATALOGUE, type PlanCode } from "@dp/domain/plans";

/**
 * Being refused because of a plan, as a route says it and a page reads it.
 *
 * billing-and-plans-spec.md S4 and S9. Three refusals, and only three, sit
 * apart from every other failure: a feature the plan does not include, a daily
 * quota used up, and the learner's own euro allowance spent. Each is an answer
 * rather than a fault, so the page shows it as an upgrade prompt — what
 * happened, when it reopens, that progress is saved — instead of the red alert
 * that means "your turn did not happen for a reason you cannot act on".
 *
 * Isomorphic on purpose: the routes build the body with it and the Client
 * Components parse it with it, so the two cannot drift into disagreeing about
 * what a refusal looks like. It reads no plan and decides nothing; the server
 * has already decided, from entitlement rows, before any of this runs.
 */

export const PLAN_REFUSALS = ["plan_required", "quota_exhausted", "budget_exhausted"] as const;

export type PlanRefusalCode = (typeof PLAN_REFUSALS)[number];

/** Whether a route's error is one of the plan's three, which are shown as a prompt. */
export function isPlanRefusal(error: string): error is PlanRefusalCode {
  return (PLAN_REFUSALS as readonly string[]).includes(error);
}

/**
 * What arrives in a refusal body. Loose about everything but the code and the
 * sentence: the body also carries a request id, and a reset time or a flag
 * that arrived garbled is dropped rather than turning the prompt back into a
 * red error.
 */
export const planRefusalSchema = z.object({
  error: z.enum(PLAN_REFUSALS),
  message: z.string().trim().min(1).max(300),
  resetAt: z.iso.datetime().nullable().catch(null),
  upgrade: z.boolean().catch(false),
});

export type PlanRefusal = z.infer<typeof planRefusalSchema>;

/** The refusal in a response body, or null for anything else — including other refusals. */
export function planRefusalFrom(body: unknown): PlanRefusal | null {
  const parsed = planRefusalSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The body a route sends. The time travels as ISO; the page formats it in the learner's zone. */
export function planRefusalBody(
  error: PlanRefusalCode,
  message: string,
  options: { readonly resetAt: Date | null; readonly upgrade: boolean },
): PlanRefusal {
  return {
    error,
    message,
    resetAt: options.resetAt?.toISOString() ?? null,
    upgrade: options.upgrade,
  };
}

const TOP_RANK = Math.max(...Object.values(PLAN_CATALOGUE).map((plan) => plan.rank));

/**
 * Whether a larger plan would lift the refusal: yes below the top plan, no at
 * it — a Premium learner is told when it reopens and nothing is sold to them.
 * And no when the plan could not be read, because that learner is served as
 * Free only as the safe floor, and may already be paying for what an upgrade
 * prompt would offer them.
 */
export function upgradeOffered(plan: PlanCode, readable: boolean): boolean {
  return readable && PLAN_CATALOGUE[plan].rank < TOP_RANK;
}

/** Whole seconds until `resetAt`, never under one, for a Retry-After header. */
export function retryAfterSeconds(resetAt: Date, now: number = Date.now()): string {
  return String(Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)));
}

/** Whose clock a time is said in. Absent, the reader's own: this runs in their browser. */
export interface ClockOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

/** The calendar day an instant falls on in a zone, as a comparable key. */
function dayKey(at: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * When the refused thing comes back, in words and in the reader's own clock
 * (spec S4: a refused request says when the window reopens). The server sends
 * an instant; only the page knows the learner's time zone.
 *
 * A quota's window reopens at a time; a euro allowance renews on a date. A
 * feature the plan lacks reopens never, and says nothing rather than a time.
 */
export function reopensLine(refusal: PlanRefusal, now: Date, clock: ClockOptions = {}): string | null {
  if (refusal.resetAt === null) return null;
  const at = new Date(refusal.resetAt);
  const { locale, timeZone } = clock;

  if (refusal.error === "budget_exhausted") {
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(at);
    return `Renews on ${date}.`;
  }

  if (at.getTime() <= now.getTime()) return "Back in a moment.";

  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
  const day = dayKey(at, timeZone);
  if (day === dayKey(now, timeZone)) return `Back at ${time}.`;
  if (day === dayKey(new Date(now.getTime() + 86_400_000), timeZone)) return `Back tomorrow at ${time}.`;

  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(at);
  return `Back on ${weekday} at ${time}.`;
}

/**
 * The refusal as something a client's fetch path can throw and its catch can
 * still read, so the one rollback path that restores the draft is also the
 * path that shows the prompt.
 */
export class PlanRefusalError extends Error {
  readonly refusal: PlanRefusal;

  constructor(refusal: PlanRefusal) {
    super(refusal.message);
    this.name = "PlanRefusalError";
    this.refusal = refusal;
  }
}
