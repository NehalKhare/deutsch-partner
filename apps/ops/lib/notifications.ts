import "server-only";

import { cache } from "react";

import { EMPTY_FEED, feedFrom } from "@dp/db/notifications-repository";
import { NOTIFICATION_FEED_LIMIT, markReadTargetSchema, type MarkReadTarget, type NotificationFeed } from "@dp/domain/notifications";

import { createOpsNotifications } from "@/lib/api/composition";

/**
 * The operators' inbox, read.
 *
 * One inbox for every operator: an alert read by one is read for all, and
 * the row says by whom. Unread first, newest first, bounded. An unreadable
 * store is an empty feed, never a number on the bell.
 *
 * The caller has already passed the operator gate; this reads with the
 * secret key because the table has no policy at all.
 */
export async function readOpsFeed(limit = NOTIFICATION_FEED_LIMIT): Promise<NotificationFeed> {
  try {
    const { notifications } = createOpsNotifications();
    const [recent, unread] = await Promise.all([notifications.list({ limit }), notifications.unreadCount()]);
    return feedFrom(recent, unread);
  } catch {
    return EMPTY_FEED;
  }
}

/** The feed once per request: the shell draws the bell, the page draws the list. */
export const currentOpsNotifications = cache(async () => readOpsFeed());

/**
 * The time this request is being rendered, once per request.
 *
 * A page's relative times ("3 hours ago") need a clock, and a component may
 * not read one mid-render: a re-render would read another. React's
 * per-request memo makes it one value for the whole render.
 */
export const requestTime = cache(async () => Date.now());

export const markTargetSchema = markReadTargetSchema;
export type MarkTarget = MarkReadTarget;

/** The form on the full page: `all`, or one id per `id` field. */
export function markTargetFromForm(formData: FormData): MarkTarget | null {
  if (formData.get("all") === "1") return "all";
  const ids = formData.getAll("id").filter((value): value is string => typeof value === "string");
  const parsed = markTargetSchema.safeParse(ids);
  return parsed.success ? parsed.data : null;
}
