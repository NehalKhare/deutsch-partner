"use server";

import { refresh } from "next/cache";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { markTargetFromForm, markTargetSchema } from "@/lib/notifications/feed";
import { createOwnNotifications } from "@/lib/notifications/server";

/**
 * Marking notifications read.
 *
 * Two entry points for the same write: the bell calls the first with a list
 * or "all" and does not wait; the page's forms post the second. Both run as
 * the signed-in learner, so no learner id is read from anywhere but the
 * session and the database function derives the owner from it. A session
 * that is not there does nothing and says nothing: a notification is not
 * worth a redirect from inside a menu.
 */
export async function markNotificationsReadAction(target: unknown): Promise<void> {
  const parsed = markTargetSchema.safeParse(target);
  if (!parsed.success) return;
  if ((await getAuthenticatedUserId()) === null) return;

  const own = await createOwnNotifications();
  await own.markRead(parsed.data);
}

export async function markNotificationsReadFormAction(formData: FormData): Promise<void> {
  const target = markTargetFromForm(formData);
  if (target === null) return;
  if ((await getAuthenticatedUserId()) === null) return;

  const own = await createOwnNotifications();
  await own.markRead(target);
  // The page the form sits on holds the list; re-render it with the mark.
  refresh();
}
