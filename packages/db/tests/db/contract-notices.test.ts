import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createContractNoticesRepository } from "../../src/contract-notices-repository";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";
import { createPgliteClient } from "../../src/testing/pglite-client";

/**
 * Cancellation and withdrawal notices, against a real engine.
 *
 * What only Postgres can confirm: the reference format and the kinds the
 * table accepts, that a reference cannot be recorded twice, and that a
 * learner's session can neither read nor write the table at all — it is
 * written through the secret key, and the confirmation on screen is what the
 * consumer keeps.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec(`delete from public.contract_notices;`);
});

const repo = () => createContractNoticesRepository(createPgliteClient(database.db));

const notice = {
  reference: "ABCDEFGH23",
  kind: "cancellation",
  email: "Learner@Example.com",
  contract: "subscription",
  detail: "Plus, monthly",
  learnerId: null,
} as const;

describe("recording a notice", () => {
  it("stores it with the time it was received, the address lower-cased", async () => {
    const recorded = await repo().record(notice);

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.data.reference).toBe("ABCDEFGH23");
    expect(recorded.data.email).toBe("learner@example.com");
    expect(recorded.data.kind).toBe("cancellation");
    expect(recorded.data.confirmedAt).toBeNull();
    expect(recorded.data.receivedAt).toBeInstanceOf(Date);
  });

  it("refuses a second notice under the same reference", async () => {
    await repo().record(notice);

    const again = await repo().record({ ...notice, email: "other@example.com" });

    expect(again.ok).toBe(false);
  });

  it("refuses a reference that is not ten upper-case characters, before any query", async () => {
    const bad = await repo().record({ ...notice, reference: "abc" });

    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("invalid_input");
  });

  it("keeps a withdrawal attached to the learner who sent it, and shows it back to them alone", async () => {
    await repo().record({ ...notice, reference: "WITHDRAW01", kind: "withdrawal", learnerId: ALICE });
    await repo().record({ ...notice, reference: "WITHDRAW02", kind: "withdrawal", learnerId: BOB });

    const alices = await repo().forLearner(ALICE);

    expect(alices.ok).toBe(true);
    if (!alices.ok) return;
    expect(alices.data.map((row) => row.reference)).toEqual(["WITHDRAW01"]);
  });

  it("marks the confirmation sent, and says when there was nothing to mark", async () => {
    await repo().record(notice);
    const at = new Date("2026-10-07T10:00:00Z");

    expect(await repo().markConfirmed("ABCDEFGH23", at)).toEqual({ ok: true, data: true });
    expect(await repo().markConfirmed("NOSUCHREF0", at)).toEqual({ ok: true, data: false });

    const row = await database.db.query<{ confirmed_at: string }>(
      `select confirmed_at from public.contract_notices where reference = 'ABCDEFGH23'`,
    );
    expect(new Date(row.rows[0]!.confirmed_at).toISOString()).toBe(at.toISOString());
  });
});

describe("what a learner's session can do with the table", () => {
  it("cannot read it", async () => {
    await repo().record({ ...notice, learnerId: ALICE });

    await database.asLearner(ALICE, async () => {
      await expect(database.db.query(`select * from public.contract_notices`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  it("cannot write it", async () => {
    await database.asLearner(ALICE, async () => {
      await expect(
        database.db.query(
          `insert into public.contract_notices (reference, kind, email, contract) values ('FORGED0001', 'cancellation', 'x@example.com', 'unknown')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
