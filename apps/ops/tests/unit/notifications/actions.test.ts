import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiters } from "@/lib/api/rate-limit";

/**
 * Reading the operators' inbox: the gate first, the quota second, the store
 * only then — and an audit line with the operator's pseudonym and the count,
 * never an id.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const HASH = "0123456789abcdef0123456789abcdef";

const currentUser = vi.fn();
const markRead = vi.fn();
const refresh = vi.fn();
const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];
const logger = {
  debug: vi.fn(),
  info: (event: string, fields: Record<string, unknown> = {}) => void logged.push({ event, fields }),
  warn: (event: string, fields: Record<string, unknown> = {}) => void logged.push({ event, fields }),
  error: (event: string, fields: Record<string, unknown> = {}) => void logged.push({ event, fields }),
};

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/require-operator", () => ({
  operatorForAction: async () => {
    const id = await currentUser();
    return id === OPERATOR ? { id, email: null, hash: HASH, aal: "aal2" } : null;
  },
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => logger,
  createOpsNotifications: () => ({ notifications: { markRead: (...args: unknown[]) => markRead(...args) }, logger }),
}));

const { markOpsNotificationsReadAction, markOpsNotificationsReadFormAction } = await import("@/app/(ops)/notifications/actions");

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  markRead.mockResolvedValue({ ok: true, data: 2 });
});

describe("marking read from the bell", () => {
  it("marks the ids as read by the operator's pseudonym, and audits the count", async () => {
    await markOpsNotificationsReadAction(["12", "13"]);

    expect(markRead).toHaveBeenCalledWith(["12", "13"], HASH);
    expect(logged).toContainEqual({
      event: "ops.notifications_read",
      fields: { audit: true, userIdHash: HASH, count: 2, all: false },
    });
  });

  it("marks everything when asked", async () => {
    await markOpsNotificationsReadAction("all");

    expect(markRead).toHaveBeenCalledWith("all", HASH);
  });

  it("refuses silently for anyone who is not an operator, before touching the store", async () => {
    currentUser.mockResolvedValue("22222222-2222-4222-8222-222222222222");

    await markOpsNotificationsReadAction("all");

    expect(markRead).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("ignores a target it cannot read", async () => {
    await markOpsNotificationsReadAction({ ids: "all" });
    await markOpsNotificationsReadAction([]);

    expect(markRead).not.toHaveBeenCalled();
  });

  it("is rate limited per operator", async () => {
    for (let i = 0; i < 30; i += 1) await markOpsNotificationsReadAction("all");
    markRead.mockClear();

    await markOpsNotificationsReadAction("all");

    expect(markRead).not.toHaveBeenCalled();
  });

  it("logs, without audit, when the store refuses", async () => {
    markRead.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });

    await markOpsNotificationsReadAction("all");

    expect(logged).toEqual([{ event: "ops.notifications_read_failed", fields: { userIdHash: HASH, errorKind: "unavailable" } }]);
  });
});

describe("marking read from the page", () => {
  it("reads the form's ids and re-renders the page", async () => {
    const form = new FormData();
    form.append("id", "12");

    await markOpsNotificationsReadFormAction(form);

    expect(markRead).toHaveBeenCalledWith(["12"], HASH);
    expect(refresh).toHaveBeenCalled();
  });

  it("reads the all flag", async () => {
    const form = new FormData();
    form.set("all", "1");

    await markOpsNotificationsReadFormAction(form);

    expect(markRead).toHaveBeenCalledWith("all", HASH);
  });
});
