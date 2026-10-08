import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  NotificationsMenu,
  badgeText,
  withRead,
  type NotificationFeed,
  type NotificationItem,
} from "../src/notifications-menu";

/**
 * The bell, for either product.
 *
 * What it must get right: the count is in the button's name and not merely
 * beside it; opening lists what was given; reading is optimistic and then
 * told to the server; and the poll asks only while the tab is looking.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    kind: "level.advanced",
    severity: "success",
    title: "Mini-level 26 mastered",
    body: "You cleared it.",
    href: "/curriculum",
    createdAt: new Date(NOW - 5 * 60_000).toISOString(),
    readAt: null,
    ...over,
  };
}

const feed = (items: NotificationItem[], unread = items.filter((entry) => entry.readAt === null).length): NotificationFeed => ({
  unread,
  items,
});

function renderMenu(over: Partial<React.ComponentProps<typeof NotificationsMenu>> = {}) {
  const markRead = vi.fn(async () => {});
  const utils = render(
    <NotificationsMenu
      initial={feed([
        item(),
        item({
          id: "n2",
          title: "Older",
          createdAt: new Date(NOW - 2 * 86_400_000).toISOString(),
          readAt: new Date(NOW - 86_400_000).toISOString(),
          href: null,
        }),
      ])}
      markRead={markRead}
      allHref="/notifications"
      now={() => NOW}
      {...over}
    />,
  );
  return { ...utils, markRead };
}

const bell = () => screen.getByRole("button", { name: /notifications/i });

describe("the badge", () => {
  it("is in the button's name, and shown only when something is unread", () => {
    renderMenu();

    expect(bell()).toHaveAccessibleName("Notifications, 1 unread");
    expect(screen.getByText("1")).toHaveAttribute("aria-hidden", "true");
  });

  it("is absent at zero and capped at 99+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");

    renderMenu({ initial: feed([], 0) });
    expect(bell()).toHaveAccessibleName("Notifications");
  });
});

describe("opened", () => {
  it("lists every notification, unread ones marked, with where each goes", async () => {
    renderMenu();
    await userEvent.click(bell());

    const panel = screen.getByRole("region", { name: /notifications/i });
    const link = within(panel).getByRole("link", { name: /Mini-level 26 mastered/ });
    expect(link).toHaveAttribute("href", "/curriculum");
    expect(link).toHaveAttribute("data-unread", "true");
    expect(within(panel).getByText("5 min ago")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "See all notifications" })).toHaveAttribute("href", "/notifications");
  });

  it("says so when there is nothing yet", async () => {
    renderMenu({ initial: feed([], 0) });
    await userEvent.click(bell());

    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });

  it("names the severity for a screen reader, not only as a colour", async () => {
    renderMenu({ initial: feed([item({ severity: "critical", title: "A job gave up", href: null })]) });
    await userEvent.click(bell());

    expect(screen.getByRole("button", { name: /Urgent, unread:\s*A job gave up/ })).toBeInTheDocument();
  });
});

describe("reading", () => {
  it("marks everything read at once: the badge clears before the server answers", async () => {
    const { markRead } = renderMenu();
    await userEvent.click(bell());

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(bell()).toHaveAccessibleName("Notifications");
    expect(markRead).toHaveBeenCalledWith("all");
  });

  it("marks one read when it is opened, and closes", async () => {
    const { markRead } = renderMenu();
    await userEvent.click(bell());

    await userEvent.click(screen.getByRole("link", { name: /Mini-level 26 mastered/ }));

    expect(markRead).toHaveBeenCalledWith(["n1"]);
    expect(bell()).toHaveAttribute("aria-expanded", "false");
    expect(bell()).toHaveAccessibleName("Notifications");
  });

  it("does not ask the server again for one already read", async () => {
    const { markRead } = renderMenu({
      initial: feed([item({ readAt: new Date(NOW).toISOString() })]),
    });
    await userEvent.click(bell());

    await userEvent.click(screen.getByRole("link", { name: /Mini-level 26 mastered/ }));

    expect(markRead).not.toHaveBeenCalled();
  });

  it("keeps a count the page did not show when only a few are marked", () => {
    const marked = withRead(feed([item(), item({ id: "n2" })], 10), ["n1"], "2026-10-08T12:00:00.000Z");

    expect(marked.unread).toBe(9);
    expect(marked.items[0]?.readAt).not.toBeNull();
    expect(marked.items[1]?.readAt).toBeNull();
    expect(withRead(marked, "all", "2026-10-08T12:00:00.000Z").unread).toBe(0);
  });

  it("yields to a fresh feed from the server when the page re-renders", () => {
    const { rerender, markRead } = renderMenu();

    rerender(
      <NotificationsMenu initial={feed([item(), item({ id: "n3" })])} markRead={markRead} allHref="/notifications" now={() => NOW} />,
    );

    expect(bell()).toHaveAccessibleName("Notifications, 2 unread");
  });
});

describe("the poll", () => {
  beforeEach(() => {
    // Only the interval: the testing library's own waiting needs real timers.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks on the interval while the tab is visible, and takes the answer", async () => {
    const refresh = vi.fn(async () => feed([item(), item({ id: "n4" })]));
    renderMenu({ refresh, pollMs: 1_000 });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 2 unread"));
  });

  it("does not ask while the tab is hidden, and asks as soon as it is seen again", async () => {
    const refresh = vi.fn(async () => feed([]));
    renderMenu({ refresh, pollMs: 1_000 });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps what it had when a poll fails", async () => {
    const refresh = vi.fn(async () => null);
    renderMenu({ refresh, pollMs: 1_000 });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(bell()).toHaveAccessibleName("Notifications, 1 unread");
  });
});
