import { z } from "zod";

import { ok, fail, mapDatabaseError, type RepositoryResult } from "./errors";
import { decodeInput, decodeRow, decodeRows } from "./result";
import type { DatabaseClient } from "./types";

/**
 * Cancellation and withdrawal notices (billing-and-plans-spec.md S11).
 *
 * A notice is written once, through the secret key, and never changed by
 * the consumer who sent it; what changes is whether its confirmation went
 * out. The repository takes the reference from its caller rather than
 * minting one, so the same reference can be shown on screen, written here
 * and put in the email, and a retry after a lost connection does not mint a
 * second.
 */

const NOTICES = "contract_notices";

export const NOTICE_KINDS = ["cancellation", "withdrawal"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_CONTRACTS = ["subscription", "pass", "unknown"] as const;
export type NoticeContract = (typeof NOTICE_CONTRACTS)[number];

export const noticeReferenceSchema = z.string().regex(/^[A-Z0-9]{10}$/);

export const newNoticeSchema = z.object({
  reference: noticeReferenceSchema,
  kind: z.enum(NOTICE_KINDS),
  email: z.email().max(254),
  contract: z.enum(NOTICE_CONTRACTS),
  detail: z.string().trim().max(500).nullable(),
  learnerId: z.uuid().nullable(),
});

export type NewNotice = z.input<typeof newNoticeSchema>;

export const contractNoticeRowSchema = z.object({
  id: z.uuid(),
  reference: noticeReferenceSchema,
  kind: z.enum(NOTICE_KINDS),
  email: z.string(),
  contract: z.enum(NOTICE_CONTRACTS),
  detail: z.string().nullable(),
  learner_id: z.uuid().nullable(),
  received_at: z.coerce.date(),
  confirmed_at: z.coerce.date().nullable(),
});

export interface ContractNotice {
  readonly id: string;
  readonly reference: string;
  readonly kind: NoticeKind;
  readonly email: string;
  readonly contract: NoticeContract;
  readonly detail: string | null;
  readonly learnerId: string | null;
  readonly receivedAt: Date;
  readonly confirmedAt: Date | null;
}

const noticeFromRow = contractNoticeRowSchema.transform(
  (row): ContractNotice => ({
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    email: row.email,
    contract: row.contract,
    detail: row.detail,
    learnerId: row.learner_id,
    receivedAt: row.received_at,
    confirmedAt: row.confirmed_at,
  }),
);

const COLUMNS = Object.keys(contractNoticeRowSchema.shape).join(", ");

export interface ContractNoticesRepository {
  /** Records a notice as received now. */
  record(notice: NewNotice): Promise<RepositoryResult<ContractNotice>>;
  /** Marks the text-form confirmation as sent. False when no such notice exists. */
  markConfirmed(reference: string, at: Date): Promise<RepositoryResult<boolean>>;
  /** A learner's own notices, newest first: what Plan & billing shows back. */
  forLearner(learnerId: string): Promise<RepositoryResult<readonly ContractNotice[]>>;
}

export function createContractNoticesRepository(client: DatabaseClient): ContractNoticesRepository {
  return {
    async record(notice) {
      const input = decodeInput(notice, newNoticeSchema);
      if (!input.ok) return input;
      const n = input.data;

      const outcome = await client
        .from(NOTICES)
        .insert({
          reference: n.reference,
          kind: n.kind,
          email: n.email.toLowerCase(),
          contract: n.contract,
          detail: n.detail === "" ? null : n.detail,
          learner_id: n.learnerId,
        })
        .select(COLUMNS)
        .single();

      return decodeRow(outcome, noticeFromRow);
    },

    async markConfirmed(reference, at) {
      const ref = decodeInput(reference, noticeReferenceSchema);
      if (!ref.ok) return ref;

      const outcome = await client
        .from(NOTICES)
        .update({ confirmed_at: at.toISOString() })
        .eq("reference", ref.data)
        .select("id");
      if (outcome.error) return fail(mapDatabaseError(outcome.error));
      return ok(Array.isArray(outcome.data) && outcome.data.length > 0);
    },

    async forLearner(learnerId) {
      const id = decodeInput(learnerId, z.uuid());
      if (!id.ok) return id;

      const outcome = await client
        .from(NOTICES)
        .select(COLUMNS)
        .eq("learner_id", id.data)
        .order("received_at", { ascending: false })
        .limit(20);
      return decodeRows(outcome, noticeFromRow);
    },
  };
}
