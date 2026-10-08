"use client";

import { notificationFeedSchema, type NotificationFeed } from "@dp/domain/notifications";
import { NotificationsMenu } from "@dp/ui/notifications-menu";

import { markNotificationsReadAction } from "@/app/(app)/notifications/actions";

/**
 * The learner's bell: the shared menu, given this product's action and poll.
 *
 * The first feed arrives from the server with the page, so the badge is
 * right before any script runs; afterwards the menu asks /api/notifications
 * now and then while the tab is visible. A poll that fails, or returns
 * something that is not a feed, changes nothing on screen.
 */
export const NOTIFICATIONS_PATH = "/notifications";

async function fetchFeed(): Promise<NotificationFeed | null> {
  try {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = notificationFeedSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function NotificationsBell({ initial }: { readonly initial: NotificationFeed }) {
  return (
    <NotificationsMenu
      initial={initial}
      markRead={markNotificationsReadAction}
      refresh={fetchFeed}
      allHref={NOTIFICATIONS_PATH}
    />
  );
}
