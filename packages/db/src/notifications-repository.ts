import { z } from "zod";

import {
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_PAGE_LIMIT,
  learnerNotificationFor,
  learnerNotificationKindSchema,
  newLearnerNotificationSchema,
  newOpsNotificationSchema,
  notificationHrefSchema,
  notificationSeveritySchema,
  opsNotificationFor,
  opsNotificationKindSchema,
  type LearnerNotificationEvent,
  type LearnerNotificationSink,
  type NewLearnerNotification,
  type NewOpsNotification,
  type NotificationFeed,
  type NotificationItem,
  type OpsNotificationEvent,
  type OpsNotificationSink,
} from "@dp/domain/notifications";

import { fail, mapDatabaseError, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRows } from "./result";
import type { DatabaseClient } from "./types";

/**
 * Notifications, from both sides of each table.
 *
 * A learner's own: the reading half runs on the learner's client, where Row
 * Level Security decides whose rows those are and the functions derive the
 * owner from the session — no method here takes a learner id. The writing
 * half is a sink on the secret key, because the rows are written *about* a
 * learner by the server, never by them.
 *
 * An operator's: operator scope, like the queue. Only ever constructed with
 * the secret-key client, from behind the ops app's own gate.
 *
 * The sinks compose the sentence from the typed event (the domain's job),
 * validate it, write it, and swallow the failure after logging it. A move
 * the learner made is still a move when the nudge about it cannot be
 * written; a run is still parked when the alert about it is not.
 */

const LEARNER_TABLE = "learner_notifications";

/** The row as the wire delivers it, turned into the one shape both menus draw. */
const stamp = z.coerce.date().transform((at) => at.toISOString());

const learnerRowSchema = z
  .object({
    id: z.uuid(),
    kind: learnerNotificationKindSchema,
    severity: notificationSeveritySchema,
    title: z.string(),
    body: z.string(),
    href: notificationHrefSchema.nullable(),
    created_at: stamp,
    read_at: stamp.nullable(),
  })
  .transform(
    (row): NotificationItem => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.created_at,
      readAt: row.read_at,
    }),
  );

const LEARNER_COLUMNS = "id, kind, severity, title, body, href, created_at, read_at";

const opsRowSchema = z
  .object({
    id: z.union([z.number().int(), z.string()]).transform(String),
    kind: opsNotificationKindSchema,
    severity: notificationSeveritySchema,
    title: z.string(),
    body: z.string(),
    href: notificationHrefSchema.nullable(),
    created_at: stamp,
    read_at: stamp.nullable(),
  })
  .transform(
    (row): NotificationItem => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.created_at,
      readAt: row.read_at,
    }),
  );

const recordedSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  created: z.boolean(),
});

export interface Recorded {
  readonly id: string;
  /** False when the same event was already there, under its dedupe key. */
  readonly created: boolean;
}

const countSchema = z.coerce.number().int().min(0);

/** Which rows to mark: a list, or everything unread. */
export type MarkTarget = readonly string[] | "all";

const idsSchema = z.array(z.uuid()).min(1).max(200);
const opsIdsSchema = z.array(z.coerce.number().int().positive()).min(1).max(200);

const limitSchema = z.number().int().min(1).max(NOTIFICATION_PAGE_LIMIT);

/** The feed when nothing could be read. */
export const EMPTY_FEED: NotificationFeed = { unread: 0, items: [] };

/**
 * The feed as a page or a poll hands it to the bell, from the two reads.
 *
 * They can fail independently. A list that could be read with a count that
 * could not shows the list and counts the unread rows it has — a floor,
 * never an invention. An unreadable list is an empty feed: an unreadable
 * database must not put a number on the bell.
 */
export function feedFrom(
  recent: RepositoryResult<readonly NotificationItem[]>,
  unread: RepositoryResult<number>,
): NotificationFeed {
  if (!recent.ok) return EMPTY_FEED;
  const items = [...recent.data];
  const counted = unread.ok ? unread.data : items.filter((item) => item.readAt === null).length;
  return { unread: counted, items };
}

/** Log fields only, and no dependency on the observability package from here. */
export interface SinkLogger {
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

// --- learners: reading ---------------------------------------------------------------

export interface LearnerNotificationsRepository {
  /** The newest, read or not. What the menu shows. */
  recent(limit?: number): Promise<RepositoryResult<readonly NotificationItem[]>>;
  /** What the badge shows: right past the page's limit, because it is a count. */
  unreadCount(): Promise<RepositoryResult<number>>;
  /** Marks the given ids, or everything unread. Returns how many changed. */
  markRead(target: MarkTarget): Promise<RepositoryResult<number>>;
}

export function createLearnerNotificationsRepository(client: DatabaseClient): LearnerNotificationsRepository {
  return {
    async recent(limit = NOTIFICATION_FEED_LIMIT) {
      const bounded = decodeInput(limit, limitSchema);
      if (!bounded.ok) return bounded;

      const outcome = await client
        .from(LEARNER_TABLE)
        .select(LEARNER_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(bounded.data);
      return decodeRows(outcome, learnerRowSchema);
    },

    async unreadCount() {
      const outcome = await client.rpc("learner_unread_notification_count");
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const count = countSchema.safeParse(outcome.data);
      return count.success ? ok(count.data) : fail(repositoryError("invalid_data"));
    },

    async markRead(target) {
      let ids: readonly string[] | null = null;
      if (target !== "all") {
        const parsed = decodeInput(target, idsSchema);
        if (!parsed.ok) return parsed;
        ids = parsed.data;
      }

      const outcome = await client.rpc("mark_learner_notifications_read", { p_ids: ids });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const count = countSchema.safeParse(outcome.data);
      return count.success ? ok(count.data) : fail(repositoryError("invalid_data"));
    },
  };
}

// --- learners: writing ---------------------------------------------------------------

export interface LearnerNotifier {
  /** Writes one, composed by the caller. Secret key. */
  record(learnerId: string, notification: NewLearnerNotification): Promise<RepositoryResult<Recorded>>;
}

export function createLearnerNotifier(client: DatabaseClient): LearnerNotifier {
  return {
    async record(learnerId, notification) {
      const id = decodeInput(learnerId, z.uuid());
      if (!id.ok) return id;
      const input = decodeInput(notification, newLearnerNotificationSchema);
      if (!input.ok) return input;
      const n = input.data;

      const outcome = await client.rpc("record_learner_notification", {
        p_learner_id: id.data,
        p_kind: n.kind,
        p_severity: n.severity,
        p_title: n.title,
        p_body: n.body,
        p_href: n.href,
        p_dedupe_key: n.dedupeKey,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const recorded = recordedSchema.safeParse(outcome.data);
      return recorded.success ? ok(recorded.data) : fail(repositoryError("invalid_data"));
    },
  };
}

/**
 * The sink the event sites hold: compose, write, and never let a failure
 * out. Logged as a code with the learner's pseudonym when one is given.
 */
export function createLearnerNotificationSink(
  client: DatabaseClient,
  options: { readonly logger?: SinkLogger; readonly pseudonymFor?: (learnerId: string) => string } = {},
): LearnerNotificationSink {
  const notifier = createLearnerNotifier(client);

  const pseudonym = options.pseudonymFor;

  return {
    async notify(learnerId: string, event: LearnerNotificationEvent) {
      let code: string;
      try {
        const written = await notifier.record(learnerId, learnerNotificationFor(event));
        if (written.ok) return;
        code = written.error.kind;
      } catch {
        code = "threw";
      }
      options.logger?.warn("notifications.learner_write_failed", {
        kind: event.kind,
        code,
        userIdHash: pseudonym ? safely(() => pseudonym(learnerId)) : undefined,
      });
    },
  };
}

function safely(fn: () => string): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// --- operators -------------------------------------------------------------------------

export interface OpsNotificationsRepository {
  /** Unread first, newest first. */
  list(options?: { readonly limit?: number; readonly unreadOnly?: boolean }): Promise<RepositoryResult<readonly NotificationItem[]>>;
  unreadCount(): Promise<RepositoryResult<number>>;
  /** Marks the given ids, or everything unread, as read by the operator's pseudonym. */
  markRead(target: MarkTarget, byHash: string): Promise<RepositoryResult<number>>;
  /** Writes one, composed by the caller. */
  record(notification: NewOpsNotification): Promise<RepositoryResult<Recorded>>;
}

const byHashSchema = z.string().min(1).max(128);

export function createOpsNotificationsRepository(client: DatabaseClient): OpsNotificationsRepository {
  return {
    async list(options = {}) {
      const bounded = decodeInput(options.limit ?? NOTIFICATION_FEED_LIMIT, limitSchema);
      if (!bounded.ok) return bounded;

      const outcome = await client.rpc("ops_notifications_list", {
        p_limit: bounded.data,
        p_unread_only: options.unreadOnly === true,
      });
      return decodeRows(outcome, opsRowSchema);
    },

    async unreadCount() {
      const outcome = await client.rpc("ops_unread_notification_count");
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const count = countSchema.safeParse(outcome.data);
      return count.success ? ok(count.data) : fail(repositoryError("invalid_data"));
    },

    async markRead(target, byHash) {
      const who = decodeInput(byHash, byHashSchema);
      if (!who.ok) return who;
      let ids: readonly number[] | null = null;
      if (target !== "all") {
        const parsed = decodeInput(target, opsIdsSchema);
        if (!parsed.ok) return parsed;
        ids = parsed.data;
      }

      const outcome = await client.rpc("mark_ops_notifications_read", { p_by_hash: who.data, p_ids: ids });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      const count = countSchema.safeParse(outcome.data);
      return count.success ? ok(count.data) : fail(repositoryError("invalid_data"));
    },

    async record(notification) {
      const input = decodeInput(notification, newOpsNotificationSchema);
      if (!input.ok) return input;
      const n = input.data;

      const outcome = await client.rpc("record_ops_notification", {
        p_kind: n.kind,
        p_severity: n.severity,
        p_title: n.title,
        p_body: n.body,
        p_href: n.href,
        p_subject: n.subject,
        p_dedupe_key: n.dedupeKey,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const recorded = recordedSchema.safeParse(outcome.data);
      return recorded.success ? ok(recorded.data) : fail(repositoryError("invalid_data"));
    },
  };
}

/** The operator sink: compose, write, log a failure, never throw. */
export function createOpsNotificationSink(
  client: DatabaseClient,
  options: { readonly logger?: SinkLogger } = {},
): OpsNotificationSink {
  const repository = createOpsNotificationsRepository(client);

  return {
    async notify(event: OpsNotificationEvent) {
      let code: string;
      try {
        const written = await repository.record(opsNotificationFor(event));
        if (written.ok) return;
        code = written.error.kind;
      } catch {
        code = "threw";
      }
      options.logger?.warn("notifications.ops_write_failed", { kind: event.kind, code });
    },
  };
}
