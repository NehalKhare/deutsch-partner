import Link from "next/link";

import { NOTIFICATION_PAGE_LIMIT } from "@dp/domain/notifications";
import { SEVERITY_DOT, SEVERITY_LABEL } from "@dp/ui/notifications-menu";
import { buttonQuiet, card, eyebrow, focusRing, linkInline, page, pageTitle, prose } from "@dp/ui/styles";
import { timeAgo } from "@dp/ui/time-ago";
import { cn } from "@dp/ui/utils";

import { markOpsNotificationsReadFormAction } from "@/app/(ops)/notifications/actions";
import { requireOperator } from "@/lib/auth/require-operator";
import { readOpsFeed, requestTime } from "@/lib/notifications";

export const metadata = { title: "Notifications — Deutsch Partner" };

/**
 * Everything that has needed a person, newest unread first.
 *
 * One inbox for every operator. A row read by one is read for all, which is
 * what an alert is for: somebody is on it. The bell shows the last few;
 * this is the whole of it, up to a page, with a form per unread row so it
 * works before hydration and a screen reader finds one button per row with
 * the row's own name.
 *
 * Nothing here names a learner: the composers in the domain write a
 * reference, a pseudonym, a run id, a scope — never an address or a word
 * anyone typed.
 */
export default async function OpsNotificationsPage() {
  await requireOperator({ route: "/notifications" });
  const [feed, now] = await Promise.all([readOpsFeed(NOTIFICATION_PAGE_LIMIT), requestTime()]);

  return (
    <main className={cn(page, "max-w-4xl")}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className={eyebrow}>Operations</p>
          <h1 className={pageTitle}>Notifications</h1>
          <p className={cn(prose, "max-w-2xl")}>
            {feed.unread === 0 ? "Nothing unread." : `${feed.unread} unread.`} Runs waiting on a decision, jobs
            that gave up, the daily budget closing, notices the law puts a clock on. Reading one reads it for
            everyone.
          </p>
        </div>
        {feed.unread > 0 ? (
          <form action={markOpsNotificationsReadFormAction}>
            <input type="hidden" name="all" value="1" />
            <button type="submit" className={buttonQuiet}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </header>

      {feed.items.length === 0 ? (
        <p className={cn(card, "text-center text-sm text-copy/70")}>Nothing yet. When something needs a person, it lands here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {feed.items.map((item) => {
            const isUnread = item.readAt === null;
            return (
              <li
                key={item.id}
                className={cn("flex gap-3 rounded-2xl border border-edge/70 p-4", isUnread ? "bg-panel/70" : "bg-panel/30")}
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
                    <span className="font-mono text-[0.7rem] text-copy/40">{item.kind}</span>
                    {item.href ? (
                      <Link href={item.href} className={cn(linkInline, "font-display")}>
                        Open
                      </Link>
                    ) : null}
                  </p>
                </div>
                {isUnread ? (
                  <form action={markOpsNotificationsReadFormAction} className="shrink-0 self-start">
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
