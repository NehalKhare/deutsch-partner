import { z } from "zod";

import { PLAN_CATALOGUE, planCodeSchema, type PlanCode } from "./plans";

/**
 * In-app notifications: what each product tells its people about.
 *
 * Two audiences, two closed sets of kinds. A learner is told about their own
 * progress, their plan and their contract; an operator is told about the
 * things that need a person — a run waiting on a decision, a job that gave
 * up, a budget about to close, a notice the law puts a clock on. Both sets
 * are closed, like the error taxonomy, so a screen can draw each kind and a
 * test can hold every kind to its wording.
 *
 * The text is composed here, from a typed event, rather than at the call
 * site. A notification written where the event happens is a sentence nobody
 * can find when it goes stale, and a sentence that may quote a learner's
 * words or a Stripe id by accident. The composers below take only what the
 * sentence needs — a level, a plan code, a stage, a count — and the schemas
 * bound what a row may hold. Nothing here does I/O: the sinks that write a
 * notification are interfaces for the repositories to implement.
 */

export const NOTIFICATION_SEVERITIES = ["info", "success", "warning", "critical"] as const;
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const LEARNER_NOTIFICATION_KINDS = [
  /** The learner moved on to the next mini-level, by asking or by earning it. */
  "level.advanced",
  "billing.subscription_started",
  "billing.subscription_ended",
  "billing.payment_failed",
  "billing.pass_granted",
  "billing.pass_revoked",
  /** The §356a BGB withdrawal notice was recorded, with its reference. */
  "account.withdrawal_received",
] as const;

export const learnerNotificationKindSchema = z.enum(LEARNER_NOTIFICATION_KINDS);
export type LearnerNotificationKind = z.infer<typeof learnerNotificationKindSchema>;

export const OPS_NOTIFICATION_KINDS = [
  /** A product-ops run parked at a human gate. */
  "productops.review_needed",
  "productops.run_failed",
  "productops.run_completed",
  /** The global daily euro budget crossed warn, degrade or deny. */
  "budget.threshold",
  /** A job spent its attempts, or could not be parsed at all. */
  "jobs.dead_lettered",
  /** A Stripe event could not be applied and is coming back. */
  "billing.event_failed",
  /** A cancellation or withdrawal notice, which the law puts a clock on. */
  "contract_notice.received",
  "account.deleted",
] as const;

export const opsNotificationKindSchema = z.enum(OPS_NOTIFICATION_KINDS);
export type OpsNotificationKind = z.infer<typeof opsNotificationKindSchema>;

export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 500;
export const NOTIFICATION_DEDUPE_MAX = 200;

/**
 * Where a notification points: a path on the same origin, or nowhere.
 *
 * Never a URL. A link in a notification is a link somebody clicks without
 * reading, so "/billing" is allowed and "//evil.example" — one slash short
 * of a path — is not.
 */
export const notificationHrefSchema = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\s]*$/, "a same-origin path");

const textFields = {
  severity: notificationSeveritySchema,
  title: z.string().trim().min(1).max(NOTIFICATION_TITLE_MAX),
  body: z.string().trim().min(1).max(NOTIFICATION_BODY_MAX),
  href: notificationHrefSchema.nullable(),
  /**
   * The same event twice is one notification. Null means every occurrence
   * is its own row: a second pass bought is a second pass.
   */
  dedupeKey: z.string().min(1).max(NOTIFICATION_DEDUPE_MAX).nullable(),
};

export const newLearnerNotificationSchema = z.object({
  kind: learnerNotificationKindSchema,
  ...textFields,
});
export type NewLearnerNotification = z.infer<typeof newLearnerNotificationSchema>;

export const newOpsNotificationSchema = z.object({
  kind: opsNotificationKindSchema,
  ...textFields,
  /**
   * What the notification is about, for grouping and for a link's target: a
   * run id, a job id, a budget scope. Never a learner id and never content.
   */
  subject: z.string().min(1).max(120).nullable(),
});
export type NewOpsNotification = z.infer<typeof newOpsNotificationSchema>;

/**
 * One notification as a screen receives it, for either audience.
 *
 * Ids are strings whatever the column is — a uuid for a learner, a bigint
 * for an operator — so the one menu component draws both. Timestamps are ISO
 * strings because the feed crosses a JSON boundary on every poll.
 */
export const notificationItemSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  severity: notificationSeveritySchema,
  title: z.string(),
  body: z.string(),
  href: notificationHrefSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationFeedSchema = z.object({
  unread: z.number().int().min(0),
  items: z.array(notificationItemSchema),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

/**
 * What a mark-read request may name: a short list of ids, or everything.
 * Ids are strings here whatever the column is; the repository behind each
 * audience checks them against its own type.
 */
export const markReadTargetSchema = z.union([
  z.literal("all"),
  z.array(z.string().min(1).max(64)).min(1).max(200),
]);
export type MarkReadTarget = z.infer<typeof markReadTargetSchema>;

/** How many a menu shows, and the most a poll returns. */
export const NOTIFICATION_FEED_LIMIT = 20;
/** How many the full page shows. */
export const NOTIFICATION_PAGE_LIMIT = 100;

// --- events, and the sentences they become -----------------------------------------

export type LearnerNotificationEvent =
  | {
      readonly kind: "level.advanced";
      readonly from: number;
      readonly to: number;
      /** The new level's theme, as the curriculum names it. */
      readonly theme: string;
      readonly cefr: string;
      /** Earned by mastering the level, or asked for. */
      readonly earned: boolean;
    }
  | { readonly kind: "billing.subscription_started"; readonly plan: PlanCode; readonly trial: boolean }
  | { readonly kind: "billing.subscription_ended"; readonly plan: PlanCode }
  | { readonly kind: "billing.payment_failed"; readonly plan: PlanCode }
  | { readonly kind: "billing.pass_granted"; readonly plan: PlanCode; readonly days: number; readonly endsAt: Date }
  | { readonly kind: "billing.pass_revoked"; readonly plan: PlanCode }
  | { readonly kind: "account.withdrawal_received"; readonly reference: string };

export type OpsNotificationEvent =
  | { readonly kind: "productops.review_needed"; readonly runId: string; readonly stage: string }
  | { readonly kind: "productops.run_failed"; readonly runId: string; readonly stage: string | null; readonly detail: string | null }
  | { readonly kind: "productops.run_completed"; readonly runId: string }
  | {
      readonly kind: "budget.threshold";
      readonly scope: string;
      readonly state: "warn" | "degrade" | "deny";
      /** Spend over limit, as a fraction. */
      readonly ratio: number;
      readonly limitEur: number;
      /** The UTC day the counter covers, as YYYY-MM-DD. One notification per state per day. */
      readonly day: string;
    }
  | {
      readonly kind: "jobs.dead_lettered";
      readonly jobId: number;
      readonly jobKind: string;
      readonly errorCode: string;
      readonly attempts: number;
    }
  | { readonly kind: "billing.event_failed"; readonly eventId: string; readonly eventType: string; readonly code: string }
  | {
      readonly kind: "contract_notice.received";
      readonly noticeKind: "cancellation" | "withdrawal";
      readonly contract: "subscription" | "pass" | "unknown";
      readonly reference: string;
    }
  | { readonly kind: "account.deleted"; readonly userIdHash: string; readonly subscriptionsEnded: number };

const planName = (code: PlanCode): string => PLAN_CATALOGUE[planCodeSchema.parse(code)].name;

const dateOnly = (at: Date): string => at.toISOString().slice(0, 10);

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/**
 * A learner's notification from an event. Pure, and the only place its
 * wording lives: the test over every kind reads these sentences back.
 */
export function learnerNotificationFor(event: LearnerNotificationEvent): NewLearnerNotification {
  switch (event.kind) {
    case "level.advanced":
      return {
        kind: event.kind,
        severity: "success",
        title: event.earned
          ? `Mini-level ${event.from} mastered`
          : `Moved on to mini-level ${event.to}`,
        body: event.earned
          ? `You cleared mini-level ${event.from} and moved on to ${event.to}, ${event.theme} (${event.cefr}).`
          : `You are now on mini-level ${event.to}, ${event.theme} (${event.cefr}). Mini-level ${event.from} is marked as skipped; come back to it any time.`,
        href: "/curriculum",
        // Every move is its own event: a learner can be moved to 27 twice.
        dedupeKey: null,
      };
    case "billing.subscription_started":
      return {
        kind: event.kind,
        severity: "success",
        title: event.trial ? `Your ${planName(event.plan)} trial has started` : `Welcome to ${planName(event.plan)}`,
        body: event.trial
          ? `Your free trial of ${planName(event.plan)} is running. It ends on its own and no card is charged.`
          : `Your ${planName(event.plan)} subscription is active. Everything it includes is open now.`,
        href: "/billing",
        dedupeKey: null,
      };
    case "billing.subscription_ended":
      return {
        kind: event.kind,
        severity: "info",
        title: `Your ${planName(event.plan)} subscription has ended`,
        body: `You are on the Free plan now. Your progress, vocabulary and mistakes are all still here.`,
        href: "/billing",
        dedupeKey: null,
      };
    case "billing.payment_failed":
      return {
        kind: event.kind,
        severity: "warning",
        title: "A payment did not go through",
        body: `The last payment for your ${planName(event.plan)} subscription failed. Update your payment method on Plan & billing to keep it.`,
        href: "/billing",
        dedupeKey: null,
      };
    case "billing.pass_granted":
      return {
        kind: event.kind,
        severity: "success",
        title: `Your ${planName(event.plan)} pass is active`,
        body: `${event.days} days of ${planName(event.plan)}, until ${dateOnly(event.endsAt)}.`,
        href: "/billing",
        dedupeKey: null,
      };
    case "billing.pass_revoked":
      return {
        kind: event.kind,
        severity: "info",
        title: `Your ${planName(event.plan)} pass was refunded`,
        body: `The pass has been withdrawn and the payment refunded. Any pass stacked behind it starts now.`,
        href: "/billing",
        dedupeKey: null,
      };
    case "account.withdrawal_received":
      return {
        kind: event.kind,
        severity: "info",
        title: "Your withdrawal notice was received",
        body: `Reference ${event.reference}. Keep it: it is the proof of when your notice reached us.`,
        href: "/billing",
        dedupeKey: `withdrawal:${event.reference}`,
      };
  }
}

const STAGE_LABELS: Readonly<Record<string, string>> = {
  human_review: "the proposal review",
  plan_review: "the plan review",
};

const stageLabel = (stage: string): string => STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");

/** An operator's notification from an event. Pure; see learnerNotificationFor. */
export function opsNotificationFor(event: OpsNotificationEvent): NewOpsNotification {
  switch (event.kind) {
    case "productops.review_needed":
      return {
        kind: event.kind,
        severity: "warning",
        title: "A proposal is waiting on you",
        body: `A market scan has parked at ${stageLabel(event.stage)}. Nothing moves until somebody decides.`,
        href: "/product",
        subject: event.runId,
        dedupeKey: `productops:review:${event.runId}:${event.stage}`,
      };
    case "productops.run_failed":
      return {
        kind: event.kind,
        severity: "critical",
        title: "A market scan failed",
        body: `The run failed${event.stage ? ` at ${stageLabel(event.stage)}` : ""}${event.detail ? ` (${event.detail})` : ""}. It can be retried from the stage that failed.`,
        href: "/product/runs",
        subject: event.runId,
        dedupeKey: `productops:failed:${event.runId}:${event.stage ?? "unknown"}`,
      };
    case "productops.run_completed":
      return {
        kind: event.kind,
        severity: "success",
        title: "A market scan completed",
        body: "The run reached the end of its pipeline. The plan is on the proposal page.",
        href: "/product",
        subject: event.runId,
        dedupeKey: `productops:completed:${event.runId}`,
      };
    case "budget.threshold":
      return {
        kind: event.kind,
        severity: event.state === "warn" ? "warning" : "critical",
        title:
          event.state === "deny"
            ? "The daily budget is spent"
            : event.state === "degrade"
              ? "The daily budget is nearly spent"
              : "The daily budget is at its warning mark",
        body:
          event.state === "deny"
            ? `${event.scope} reached ${percent(event.ratio)} of ${event.limitEur} EUR. Model calls are being refused until the day rolls over or the limit is raised.`
            : event.state === "degrade"
              ? `${event.scope} is at ${percent(event.ratio)} of ${event.limitEur} EUR. Every call now runs one tier down with a halved reply ceiling.`
              : `${event.scope} is at ${percent(event.ratio)} of ${event.limitEur} EUR.`,
        href: "/costs/budgets",
        subject: event.scope,
        dedupeKey: `budget:${event.scope}:${event.state}:${event.day}`,
      };
    case "jobs.dead_lettered":
      return {
        kind: event.kind,
        severity: "critical",
        title: `A ${event.jobKind} job gave up`,
        body: `Job ${event.jobId} failed for good after ${event.attempts} ${event.attempts === 1 ? "attempt" : "attempts"} (${event.errorCode}). It will not be retried on its own.`,
        href: null,
        subject: String(event.jobId),
        dedupeKey: `jobs:dead:${event.jobId}`,
      };
    case "billing.event_failed":
      return {
        kind: event.kind,
        severity: "critical",
        title: "A Stripe event could not be applied",
        body: `${event.eventType} failed with ${event.code}. Stripe will retry it; if it keeps failing, a Price or a customer is set up wrong.`,
        href: null,
        subject: event.eventId,
        dedupeKey: `billing:event:${event.eventId}`,
      };
    case "contract_notice.received":
      return {
        kind: event.kind,
        severity: "warning",
        title: event.noticeKind === "withdrawal" ? "A withdrawal notice arrived" : "A cancellation notice arrived",
        body: `Reference ${event.reference}, about a ${event.contract === "unknown" ? "contract the consumer could not name" : event.contract}. The text-form confirmation is owed without delay.`,
        href: null,
        subject: event.reference,
        dedupeKey: `notice:${event.reference}`,
      };
    case "account.deleted":
      return {
        kind: event.kind,
        severity: "info",
        title: "A learner deleted their account",
        body: `Learner ${event.userIdHash.slice(0, 12)} is gone${event.subscriptionsEnded > 0 ? `, with ${event.subscriptionsEnded} subscription${event.subscriptionsEnded === 1 ? "" : "s"} set to end at its paid period` : ""}.`,
        href: null,
        subject: event.userIdHash,
        dedupeKey: `account:deleted:${event.userIdHash}`,
      };
  }
}

// --- the ports --------------------------------------------------------------------------

/**
 * Where a learner's notification is written. Implemented over the secret
 * key, because a learner may read their notifications and never write one.
 * Never throws and never fails the thing that raised the event: a move that
 * cannot be announced is still a move.
 */
export interface LearnerNotificationSink {
  notify(learnerId: string, event: LearnerNotificationEvent): Promise<void>;
}

/** Where an operator's notification is written. Same contract. */
export interface OpsNotificationSink {
  notify(event: OpsNotificationEvent): Promise<void>;
}

/** A sink that drops everything: for a process with nothing to write to. */
export const NO_LEARNER_NOTIFICATIONS: LearnerNotificationSink = { async notify() {} };
export const NO_OPS_NOTIFICATIONS: OpsNotificationSink = { async notify() {} };
