import { describe, expect, it, vi } from "vitest";

import {
  PSEUDONYM_SCAN_BATCH,
  createLearnerAccounts,
  deletionPhrase,
  findLearnerByPseudonym,
} from "@/lib/learner-directory";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/** A pseudonym that is readable in a test: the id's first block, repeated. */
const fakeHash = (id: string) => id.slice(0, 8).repeat(4);

describe("finding a learner by pseudonym", () => {
  it("hashes each profile id until one matches", async () => {
    const profileIds = vi.fn(async () => ({ ok: true as const, data: [ALICE, BOB] }));

    const found = await findLearnerByPseudonym({ profileIds }, fakeHash(BOB), fakeHash);

    expect(found).toEqual({ status: "found", learnerId: BOB });
  });

  it("walks the ids in batches, from where the last batch ended", async () => {
    const first = Array.from({ length: PSEUDONYM_SCAN_BATCH }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const profileIds = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: first })
      .mockResolvedValueOnce({ ok: true, data: [BOB] });

    const found = await findLearnerByPseudonym({ profileIds }, fakeHash(BOB), fakeHash);

    expect(found).toEqual({ status: "found", learnerId: BOB });
    expect(profileIds).toHaveBeenNthCalledWith(1, null, PSEUDONYM_SCAN_BATCH);
    expect(profileIds).toHaveBeenNthCalledWith(2, first.at(-1), PSEUDONYM_SCAN_BATCH);
  });

  it("says not found once the ids run out", async () => {
    const profileIds = vi.fn(async () => ({ ok: true as const, data: [ALICE] }));

    expect(await findLearnerByPseudonym({ profileIds }, fakeHash(BOB), fakeHash)).toEqual({ status: "not_found" });
  });

  it("says unavailable rather than not found when the ids cannot be read", async () => {
    const profileIds = vi.fn(async () => ({ ok: false as const, error: new Error("down") }));

    expect(await findLearnerByPseudonym({ profileIds } as never, fakeHash(BOB), fakeHash)).toEqual({
      status: "unavailable",
    });
  });

  it("refuses a string that is not a pseudonym without reading anything", async () => {
    const profileIds = vi.fn();

    expect(await findLearnerByPseudonym({ profileIds }, "alice@example.com", fakeHash)).toEqual({
      status: "not_found",
    });
    expect(profileIds).not.toHaveBeenCalled();
  });
});

function adminWith(pages: Array<Array<{ id: string; email?: string | null }>>) {
  return {
    listUsers: vi.fn(async ({ page }: { page: number; perPage: number }) => ({
      data: { users: pages[page - 1] ?? [] },
      error: null,
    })),
    getUserById: vi.fn(async (id: string) => ({
      data: { user: { id, email: "alice@example.com", created_at: "2026-09-01T00:00:00Z", last_sign_in_at: null } },
      error: null,
    })),
    deleteUser: vi.fn(async () => ({ data: {}, error: null })),
  };
}

describe("finding an account by email", () => {
  it("matches the address exactly, ignoring case and spaces", async () => {
    const admin = adminWith([[{ id: BOB, email: "bob@example.com" }, { id: ALICE, email: "Alice@Example.com" }]]);

    expect(await createLearnerAccounts(admin).findByEmail("  alice@example.COM ")).toEqual({
      status: "found",
      learnerId: ALICE,
    });
  });

  it("does not match a partial address", async () => {
    const admin = adminWith([[{ id: ALICE, email: "alice@example.com" }]]);

    expect(await createLearnerAccounts(admin).findByEmail("lice@example.com")).toEqual({ status: "not_found" });
  });

  it("pages until a short page says there are no more", async () => {
    const full = Array.from({ length: 1000 }, (_, index) => ({ id: `id-${index}`, email: `u${index}@x.test` }));
    const admin = adminWith([full, [{ id: ALICE, email: "alice@example.com" }]]);

    expect(await createLearnerAccounts(admin).findByEmail("alice@example.com")).toEqual({
      status: "found",
      learnerId: ALICE,
    });
    expect(admin.listUsers).toHaveBeenCalledTimes(2);
  });

  it("refuses something that is not an email", async () => {
    const admin = adminWith([]);

    expect(await createLearnerAccounts(admin).findByEmail("not an email")).toEqual({ status: "invalid" });
    expect(admin.listUsers).not.toHaveBeenCalled();
  });

  it("says unavailable when the auth service fails", async () => {
    const admin = adminWith([]);
    admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: "down" } } as never);

    expect(await createLearnerAccounts(admin).findByEmail("alice@example.com")).toEqual({ status: "unavailable" });
  });
});

describe("an account's own details", () => {
  it("are read from the auth service, for the export only", async () => {
    const admin = adminWith([]);

    expect(await createLearnerAccounts(admin).get(ALICE)).toEqual({
      email: "alice@example.com",
      createdAt: "2026-09-01T00:00:00Z",
      lastSignInAt: null,
    });
  });

  it("are deleted through the auth service, which the learner tables cascade from", async () => {
    const admin = adminWith([]);

    expect(await createLearnerAccounts(admin).delete(ALICE)).toEqual({ ok: true });
    expect(admin.deleteUser).toHaveBeenCalledWith(ALICE);
  });
});

describe("the phrase that confirms a deletion", () => {
  it("names the learner, so a form for one cannot delete another", () => {
    expect(deletionPhrase("0123456789abcdef0123456789abcdef")).toBe("delete 01234567");
  });
});
