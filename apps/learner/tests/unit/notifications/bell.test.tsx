import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NOTIFICATIONS_PATH, NotificationsBell } from "@/components/site/notifications-bell";

/**
 * The learner's bell is the shared menu with this product's action and
 * page behind it. What is this product's to pin: reading goes through the
 * server action, and "see all" goes to this product's page.
 */

const { markRead } = vi.hoisted(() => ({ markRead: vi.fn(async (_target: unknown) => {}) }));

vi.mock("@/app/(app)/notifications/actions", () => ({
  markNotificationsReadAction: (target: unknown) => markRead(target),
}));

const FEED = {
  unread: 1,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "level.advanced",
      severity: "success" as const,
      title: "Mini-level 26 mastered",
      body: "You cleared it.",
      href: "/curriculum",
      createdAt: "2026-10-08T10:00:00.000Z",
      readAt: null,
    },
  ],
};

describe("the learner's bell", () => {
  it("shows the count the server rendered and marks through the server action", async () => {
    render(<NotificationsBell initial={FEED} />);
    const bell = screen.getByRole("button", { name: "Notifications, 1 unread" });

    await userEvent.click(bell);
    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(markRead).toHaveBeenCalledWith("all");
  });

  it("leads to this product's notifications page", async () => {
    render(<NotificationsBell initial={FEED} />);

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(screen.getByRole("link", { name: "See all notifications" })).toHaveAttribute("href", NOTIFICATIONS_PATH);
    expect(NOTIFICATIONS_PATH).toBe("/notifications");
  });
});
