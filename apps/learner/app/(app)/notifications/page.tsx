import Link from "next/link";

import { NOTIFICATION_PAGE_LIMIT } from "@dp/domain/notifications";
import { SEVERITY_DOT, SEVERITY_LABEL } from "@dp/ui/notifications-menu";
import { buttonQuiet, eyebrow, focusRing, linkInline, pageTitle, prose } from "@dp/ui/styles";
import { timeAgo } from "@dp/ui/time-ago";
import { cn } from "@dp/ui/utils";

import { markNotificationsReadFormAction } from "@/app/(app)/notifications/actions";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { feedFrom } from "@/lib/notifications/feed";
import { createOwnNotifications, requestTime } from "@/lib/notifications/server";

export const metadata = { title: "Notifications" };

/**
 * Everything the product has told this learner, newest first.
 *
 * The bell shows the last few; this is the whole of it, up to a page. Plain
 * forms rather than a client menu: a row is marked read by a button in a
 * form that posts to a server action, so the page works before hydration
 * and a screen reader finds one button per row with the row's own name.
 */
export default async function NotificationsPage() {
  await requireAuthenticatedUserId();
  const own = await createOwnNotifications();
  const [recent, unread, now] = await Promise.all([own.recent(NOTIFICATION_PAGE_LIMIT), own.unreadCount(), requestTime()]);
  const feed = feedFrom(recent, unread);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className={eyebrow}>Your account</p>
          <h1 className={pageTitle}>Notifications</h1>
          <p className={cn(prose, "text-sm")}>
            {feed.unread === 0
              ? "Nothing unread."
              : `${feed.unread} unread.`}{" "}
            Level moves, your plan, and anything about your contract land here.
          </p>
        </div>
        {feed.unread > 0 ? (
          <form action={markNotificationsReadFormAction}>
            <input type="hidden" name="all" value="1" />
            <button type="submit" className={buttonQuiet}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </header>

      {!recent.ok ? (
        <p className={cn(prose, "rounded-2xl border border-edge/70 bg-panel/50 p-4 text-sm")}>
          Your notifications could not be loaded just now. Please refresh and try again.
        </p>
      ) : feed.items.length === 0 ? (
        <p className={cn(prose, "rounded-2xl border border-edge/70 bg-panel/50 p-6 text-center text-sm")}>
          Nothing yet. When something happens, it lands here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {feed.items.map((item) => {
            const isUnread = item.readAt === null;
            return (
              <li
                key={item.id}
                className={cn(
                  "flex gap-3 rounded-2xl border border-edge/70 p-4",
                  isUnread ? "bg-panel/70" : "bg-panel/30",
                )}
              >
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className={cn("font-display text-sm leading-snug", isUnread ? "font-semibold text-copy" : "text-copy/80")}>
                    <span className="sr-only">
                      {SEVERITY_LABEL[item.severity]}
                      {isUnread ? ", unread" : ""}:{" "}
                    </span>
                    {item.title}
                  </p>
                  <p className="text-sm leading-snug text-copy/70">{item.body}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-copy/50">
                    <time dateTime={item.createdAt}>{timeAgo(item.createdAt, now)}</time>
                    {item.href ? (
                      <Link href={item.href} className={cn(linkInline, "font-display")}>
                        Open
                      </Link>
                    ) : null}
                  </p>
                </div>
                {isUnread ? (
                  <form action={markNotificationsReadFormAction} className="shrink-0 self-start">
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      aria-label={`Mark "${item.title}" as read`}
                      className={cn("rounded-md font-display text-xs text-brand hover:underline", focusRing)}
                    >
                      Mark as read
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
