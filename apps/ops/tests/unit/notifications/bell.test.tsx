import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OPS_NOTIFICATIONS_PATH, OpsNotifications } from "@/components/ops-notifications";
import { OpsShell } from "@/components/ops-shell";

/**
 * The operators' bell: the shared menu with this product's action and page
 * behind it, and a slot in the shell's header beside the account.
 */

const { markRead } = vi.hoisted(() => ({ markRead: vi.fn(async (_target: unknown) => {}) }));

vi.mock("next/navigation", () => ({ usePathname: () => "/costs" }));
vi.mock("@/app/(ops)/notifications/actions", () => ({
  markOpsNotificationsReadAction: (target: unknown) => markRead(target),
}));

const FEED = {
  unread: 2,
  items: [
    {
      id: "12",
      kind: "productops.review_needed",
      severity: "warning" as const,
      title: "A proposal is waiting on you",
      body: "A market scan has parked at the proposal review.",
      href: "/product",
      createdAt: "2026-10-08T10:00:00.000Z",
      readAt: null,
    },
  ],
};

describe("the operators' bell", () => {
  it("shows the count and marks through the server action", async () => {
    render(<OpsNotifications initial={FEED} />);

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await userEvent.click(screen.getByRole("link", { name: /A proposal is waiting on you/ }));

    expect(markRead).toHaveBeenCalledWith(["12"]);
  });

  it("leads to this product's notifications page", async () => {
    render(<OpsNotifications initial={FEED} />);

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(screen.getByRole("link", { name: "See all notifications" })).toHaveAttribute("href", OPS_NOTIFICATIONS_PATH);
  });

  it("sits in the shell's header, beside the account", () => {
    render(
      <OpsShell email="op@example.com" signOut={async () => {}} notifications={<OpsNotifications initial={FEED} />}>
        <p>page</p>
      </OpsShell>,
    );

    const header = screen.getByRole("banner");
    expect(header).toContainElement(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    expect(header).toContainElement(screen.getByRole("button", { name: /op@example.com|op/ }));
  });
});
