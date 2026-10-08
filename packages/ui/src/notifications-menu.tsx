"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Bell } from "lucide-react";

import { focusRing } from "./styles";
import { timeAgo } from "./time-ago";
import { useDisclosure } from "./use-disclosure";
import { cn } from "./utils";

/**
 * The bell.
 *
 * One component for both products, because a notification is the same thing
 * in either: a sentence, a severity, a time, maybe a link, and whether it has
 * been seen. The learner's tells them they moved up a level; the operator's
 * tells them a run is waiting. Which palette it wears is the page's business.
 *
 * It is a disclosure holding a list, like the account menu beside it, and
 * for the same reason: links and buttons already have Tab and Enter, and
 * `role="menu"` would take those away. The badge is a count the button's
 * accessible name carries ("Notifications, 3 unread"), so it is never a
 * number read aloud with nothing to attach it to.
 *
 * What it owns: the open state, an optimistic copy of the feed, and a poll.
 * What it is given: the first feed (rendered on the server, so the badge is
 * right before any script runs), the action that marks rows read, and a
 * fetch that returns a fresh feed. The poll runs only while the tab is
 * visible and asks again when it becomes visible, so a tab left open all
 * night makes one request in the morning rather than four hundred overnight.
 */

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface NotificationItem {
  readonly id: string;
  readonly kind: string;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationFeed {
  readonly unread: number;
  readonly items: readonly NotificationItem[];
}

export interface NotificationsMenuProps {
  readonly initial: NotificationFeed;
  /** Marks rows read on the server. The menu does not wait to redraw. */
  readonly markRead: (target: readonly string[] | "all") => Promise<void>;
  /** A fresh feed, or null when it could not be fetched. Polled when given. */
  readonly refresh?: () => Promise<NotificationFeed | null>;
  readonly pollMs?: number;
  /** The page with the whole list. */
  readonly allHref: string;
  /** The clock, for the relative times. */
  readonly now?: () => number;
}

export const DEFAULT_POLL_MS = 60_000;

/** The dot before a title, by severity. Role colours, so both themes draw it. */
export const SEVERITY_DOT: Readonly<Record<NotificationSeverity, string>> = {
  info: "bg-brand",
  success: "bg-sprout",
  warning: "border-2 border-ember bg-transparent",
  critical: "bg-ember",
};

export const SEVERITY_LABEL: Readonly<Record<NotificationSeverity, string>> = {
  info: "Information",
  success: "Good news",
  warning: "Needs attention",
  critical: "Urgent",
};

const ROW =
  "flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-edge/40";

/** The unread count as the badge prints it. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}

/** The feed with the given rows (or every row) marked read, for the optimistic redraw. */
export function withRead(feed: NotificationFeed, target: readonly string[] | "all", at: string): NotificationFeed {
  const ids = target === "all" ? null : new Set(target);
  let marked = 0;
  const items = feed.items.map((item) => {
    if (item.readAt !== null) return item;
    if (ids !== null && !ids.has(item.id)) return item;
    marked += 1;
    return { ...item, readAt: at };
  });
  // "All" clears the count whatever the page held; a list clears only what it named.
  const unread = ids === null ? 0 : Math.max(0, feed.unread - marked);
  return { unread, items };
}

export function NotificationsMenu({
  initial,
  markRead,
  refresh,
  pollMs = DEFAULT_POLL_MS,
  allHref,
  now = () => Date.now(),
}: NotificationsMenuProps) {
  const { open, setOpen, container, trigger } = useDisclosure();
  const panelId = useId();
  const labelId = useId();
  const [feed, setFeed] = useState<NotificationFeed>(initial);
  const [adopted, setAdopted] = useState(initial);

  // A navigation re-renders the shell with a fresh feed from the server;
  // that is the truth, and the optimistic copy yields to it. Adjusted during
  // render rather than in an effect, so there is no frame showing the old one.
  if (adopted !== initial) {
    setAdopted(initial);
    setFeed(initial);
  }

  useEffect(() => {
    if (!refresh) return;

    let live = true;
    const ask = async () => {
      if (document.visibilityState !== "visible") return;
      const fresh = await refresh().catch(() => null);
      if (live && fresh) setFeed(fresh);
    };
    const timer = setInterval(() => void ask(), pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);

  const mark = (target: readonly string[] | "all") => {
    setFeed((current) => withRead(current, target, new Date(now()).toISOString()));
    void markRead(target).catch(() => undefined);
  };

  const badge = badgeText(feed.unread);
  const name = badge ? `Notifications, ${feed.unread} unread` : "Notifications";

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        id={labelId}
        aria-label={name}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "relative flex size-10 items-center justify-center rounded-full border transition-colors",
          open
            ? "border-brand/50 bg-brand/10 text-copy"
            : "border-edge/60 text-copy/70 hover:border-copy/30 hover:text-copy",
          focusRing,
        )}
      >
        <Bell aria-hidden className="size-4.5" strokeWidth={1.75} />
        {badge ? (
          <span
            aria-hidden
            data-role="unread-count"
            className={cn(
              "absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-ember px-1 py-0.5",
              "text-center text-[0.65rem] leading-none font-semibold text-on-accent tabular-nums",
              "ring-2 ring-ground",
            )}
          >
            {badge}
          </span>
        ) : null}
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={labelId}
        hidden={!open}
        className={cn(
          "absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-edge/70 bg-raised p-1.5",
          "shadow-lg shadow-shade/40",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-3 pt-1.5 pb-2">
          <p className="font-display text-sm font-semibold text-copy">Notifications</p>
          {feed.unread > 0 ? (
            <button
              type="button"
              onClick={() => mark("all")}
              className={cn("rounded-md font-display text-xs text-brand hover:underline", focusRing)}
            >
              Mark all as read
            </button>
          ) : null}
        </div>

        {feed.items.length === 0 ? (
          <p className="border-t border-edge/50 px-3 py-6 text-center text-sm text-copy/60">
            Nothing yet. When something happens, it lands here.
          </p>
        ) : (
          <ul className="flex max-h-[min(28rem,60vh)] flex-col overflow-y-auto border-t border-edge/50 pt-1.5">
            {feed.items.map((item) => (
              <li key={item.id}>
                <NotificationRow
                  item={item}
                  now={now()}
                  onOpen={() => {
                    if (item.readAt === null) mark([item.id]);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1.5 border-t border-edge/50 pt-1.5">
          <Link
            href={allHref}
            onClick={() => setOpen(false)}
            className={cn("block rounded-lg px-3 py-2 font-display text-sm text-copy/75 hover:bg-edge/40 hover:text-copy", focusRing)}
          >
            See all notifications
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * One notification. A link when it has somewhere to go; a button that marks
 * it read when it does not. Unread rows are drawn a shade stronger, and the
 * severity is a dot with a name only a screen reader hears.
 */
export function NotificationRow({
  item,
  now,
  onOpen,
}: {
  readonly item: NotificationItem;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const unread = item.readAt === null;
  const body = (
    <>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} />
      <span className="sr-only">{SEVERITY_LABEL[item.severity]}{unread ? ", unread" : ""}: </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("font-display text-sm leading-snug", unread ? "font-semibold text-copy" : "text-copy/80")}>
          {item.title}
        </span>
        <span className="text-xs leading-snug text-copy/65">{item.body}</span>
        <span className="text-[0.7rem] text-copy/45">{timeAgo(item.createdAt, now)}</span>
      </span>
    </>
  );

  if (item.href) {
    return (
      <Link href={item.href} onClick={onOpen} className={cn(ROW, focusRing)} data-unread={unread || undefined}>
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!unread}
      className={cn(ROW, "disabled:cursor-default disabled:hover:bg-transparent", focusRing)}
      data-unread={unread || undefined}
    >
      {body}
    </button>
  );
}
