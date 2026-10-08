import "server-only";

import { cache } from "react";

import {
  createLearnerNotificationSink,
  createLearnerNotificationsRepository,
  createOpsNotificationSink,
  type LearnerNotificationsRepository,
} from "@dp/db/notifications-repository";
import type { DatabaseClient } from "@dp/db/types";
import {
  NOTIFICATION_FEED_LIMIT,
  type LearnerNotificationSink,
  type NotificationFeed,
  type OpsNotificationSink,
} from "@dp/domain/notifications";

import { actionLogger, pseudonymOrUnavailable } from "@/lib/api/composition";
import { EMPTY_FEED, feedFrom } from "@/lib/notifications/feed";
import { createSecretKeySupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server-client";

/**
 * Notifications, wired.
 *
 * Reading is the learner's: their own client, so Row Level Security decides
 * whose rows those are and the functions derive the owner from the session.
 * Writing is the server's, about the learner, through the secret key — the
 * table grants a learner no insert, by design (a learner who could write one
 * could tell themselves they bought a plan). The operator sink is the same
 * key for the same reason: ops_notifications has RLS on and no policy.
 */

/** The learner's own notifications: read and acknowledge, under RLS. */
export async function createOwnNotifications(): Promise<LearnerNotificationsRepository> {
  const client = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  return createLearnerNotificationsRepository(client);
}

/** The feed as the bell and the poll show it. Never throws; an unreadable store is an empty feed. */
export async function readOwnFeed(limit = NOTIFICATION_FEED_LIMIT): Promise<NotificationFeed> {
  try {
    const own = await createOwnNotifications();
    const [recent, unread] = await Promise.all([own.recent(limit), own.unreadCount()]);
    return feedFrom(recent, unread);
  } catch {
    return EMPTY_FEED;
  }
}

/**
 * The feed once per request. The shell renders the bell on every page and
 * the notifications page renders the list; `cache()` means a visit to that
 * page reads once, not twice. No arguments, deliberately: memoisation is
 * keyed on them, and a fresh client per call would make every call a miss.
 */
export const currentNotifications = cache(async () => readOwnFeed());

/**
 * The time this request is being rendered, once per request.
 *
 * A page's relative times ("3 hours ago") need a clock, and a component may
 * not read one mid-render: a re-render would read another. React's
 * per-request memo makes it one value for the whole render.
 */
export const requestTime = cache(async () => Date.now());

/** Where a learner is told something, from the server. Secret key. */
export function createLearnerNotifications(): LearnerNotificationSink {
  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;
  return createLearnerNotificationSink(client, { logger: actionLogger(), pseudonymFor: pseudonymOrUnavailable });
}

/** Where the operators are told something, from this app. Secret key. */
export function createOpsAlerts(): OpsNotificationSink {
  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;
  return createOpsNotificationSink(client, { logger: actionLogger() });
}
