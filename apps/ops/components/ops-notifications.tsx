"use client";

import { notificationFeedSchema, type NotificationFeed } from "@dp/domain/notifications";
import { NotificationsMenu } from "@dp/ui/notifications-menu";

import { markOpsNotificationsReadAction } from "@/app/(ops)/notifications/actions";

/**
 * The operators' bell: the shared menu, given this product's action and
 * poll. Same component as the learner's, in the operator's palette; what
 * differs is behind it — one inbox for every operator, read once for all.
 */
export const OPS_NOTIFICATIONS_PATH = "/notifications";

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

export function OpsNotifications({ initial }: { readonly initial: NotificationFeed }) {
  return (
    <NotificationsMenu
      initial={initial}
      markRead={markOpsNotificationsReadAction}
      refresh={fetchFeed}
      allHref={OPS_NOTIFICATIONS_PATH}
    />
  );
}
