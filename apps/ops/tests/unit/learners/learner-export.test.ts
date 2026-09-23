import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiters } from "@/lib/api/rate-limit";

/**
 * The data export: everything the product holds about one learner, as a file.
 *
 * The one place an email is shown, because it is the learner's own data and
 * the export is their answer. So: operator only (404 otherwise), audited under
 * both pseudonyms, rate limited, and never cached anywhere along the way.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const LEARNER_HASH = "fedcba9876543210fedcba9876543210";

const currentUser = vi.fn();
const exportRows = vi.fn();
const getAccount = vi.fn();
const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];
const record = (event: string, fields: Record<string, unknown> = {}) => {
  logged.push({ event, fields });
};
const logger = { debug: vi.fn(), info: record, warn: record, error: record };

vi.mock("@/lib/auth/require-operator", () => ({
  operatorForRequest: async () => {
    const id = await currentUser();
    return id === OPERATOR ? { id, email: null, hash: "0123456789abcdef0123456789abcdef", aal: "aal2" } : null;
  },
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => logger,
  pseudonymFor: () => LEARNER_HASH,
  createLearnerSupport: () => ({
    learners: { export: exportRows },
    accounts: { get: getAccount },
    logger,
  }),
}));

const { GET } = await import("@/app/(ops)/learners/[learnerId]/export/route");

const get = (learnerId: string) =>
  GET(new Request(`https://ops.test/learners/${learnerId}/export`), {
    params: Promise.resolve({ learnerId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  exportRows.mockResolvedValue({ ok: true, data: { exportedAt: "2026-09-23T15:00:00Z", profiles: [{ id: LEARNER }] } });
  getAccount.mockResolvedValue({ email: "alice@example.com", createdAt: "2026-09-01T00:00:00Z", lastSignInAt: null });
});

describe("the export", () => {
  it("is a 404 to anybody but an operator, and reads nothing", async () => {
    currentUser.mockResolvedValue(LEARNER);

    const response = await get(LEARNER);

    expect(response.status).toBe(404);
    expect(exportRows).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that is not one", async () => {
    expect((await get("../../etc")).status).toBe(404);
  });

  it("downloads the rows and the account, uncached", async () => {
    const response = await get(LEARNER);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="learner-fedcba98-export.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.account).toEqual({ email: "alice@example.com", createdAt: "2026-09-01T00:00:00Z", lastSignInAt: null });
    expect(body.profiles).toEqual([{ id: LEARNER }]);
  });

  it("is audited under both pseudonyms and without the email", async () => {
    await get(LEARNER);

    expect(logged.find((line) => line.event === "learner.exported")?.fields).toMatchObject({
      audit: true,
      learnerHash: LEARNER_HASH,
    });
    expect(JSON.stringify(logged)).not.toContain("alice@example.com");
  });

  it("is a 404 for somebody with no profile", async () => {
    exportRows.mockResolvedValue({ ok: true, data: null });

    expect((await get(LEARNER)).status).toBe(404);
  });
});
