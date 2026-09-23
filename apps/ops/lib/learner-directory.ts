import { z } from "zod";

import type { LearnerAdminRepository } from "@dp/db/learner-admin-repository";

/**
 * Finding a learner, and the account behind them.
 *
 * Operators never browse by email. The pages list the ledger's pseudonym; an
 * operator arrives either with a pseudonym (from the ledger, the budgets page,
 * an incident) or with an email a learner wrote in from, and each lookup
 * resolves to an account id without an email ever being listed.
 *
 * The pseudonym is a keyed hash and cannot be reversed, so resolving one means
 * hashing profile ids until one matches. That is linear in learners, and it
 * is capped: past the cap the page says so instead of scanning forever. The
 * email lookup is the same shape against the auth service, which offers no
 * exact-match query through the client. Both are fine at this product's size
 * and both say plainly when they stop being fine.
 *
 * Accounts are read and deleted through the Auth admin API rather than SQL:
 * the auth schema belongs to the auth service, and deleting its user is what
 * cascades through every learner table.
 */

export const PSEUDONYM_SCAN_BATCH = 1_000;
/** 50,000 learners. Past this, resolving a pseudonym needs a stored index. */
const PSEUDONYM_SCAN_BATCHES = 50;

const AUTH_PAGE_SIZE = 1_000;
/** 50,000 accounts, as above. */
const AUTH_PAGES = 50;

export type Lookup =
  | { readonly status: "found"; readonly learnerId: string }
  | { readonly status: "not_found" }
  | { readonly status: "invalid" }
  | { readonly status: "too_many" }
  | { readonly status: "unavailable" };

const pseudonymSchema = z.string().regex(/^[0-9a-f]{32}$/);

export async function findLearnerByPseudonym(
  learners: Pick<LearnerAdminRepository, "profileIds">,
  pseudonym: string,
  hash: (learnerId: string) => string,
): Promise<Lookup> {
  if (!pseudonymSchema.safeParse(pseudonym).success) return { status: "not_found" };

  let after: string | null = null;
  for (let batch = 0; batch < PSEUDONYM_SCAN_BATCHES; batch += 1) {
    const ids = await learners.profileIds(after, PSEUDONYM_SCAN_BATCH);
    if (!ids.ok) return { status: "unavailable" };

    const match = ids.data.find((id) => hash(id) === pseudonym);
    if (match !== undefined) return { status: "found", learnerId: match };
    if (ids.data.length < PSEUDONYM_SCAN_BATCH) return { status: "not_found" };

    after = ids.data.at(-1) ?? null;
  }

  return { status: "too_many" };
}

/** The slice of `supabase.auth.admin` this module uses. */
export interface AuthAdmin {
  listUsers(params: { page: number; perPage: number }): PromiseLike<{
    data: { users: ReadonlyArray<{ id: string; email?: string | null }> };
    error: unknown;
  }>;
  getUserById(id: string): PromiseLike<{
    data: { user: { email?: string | null; created_at: string; last_sign_in_at?: string | null } | null };
    error: unknown;
  }>;
  deleteUser(id: string): PromiseLike<{ error: unknown }>;
}

export interface AccountDetails {
  readonly email: string | null;
  readonly createdAt: string;
  readonly lastSignInAt: string | null;
}

export interface LearnerAccounts {
  findByEmail(email: string): Promise<Lookup>;
  /** For the data export only: the one place an email is ever shown. */
  get(learnerId: string): Promise<AccountDetails | null>;
  delete(learnerId: string): Promise<{ readonly ok: boolean }>;
}

const emailSchema = z.email();

export function createLearnerAccounts(admin: AuthAdmin): LearnerAccounts {
  return {
    async findByEmail(email) {
      const wanted = email.trim().toLowerCase();
      if (!emailSchema.safeParse(wanted).success) return { status: "invalid" };

      for (let page = 1; page <= AUTH_PAGES; page += 1) {
        const { data, error } = await admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
        if (error) return { status: "unavailable" };

        const match = data.users.find((user) => user.email?.trim().toLowerCase() === wanted);
        if (match !== undefined) return { status: "found", learnerId: match.id };
        if (data.users.length < AUTH_PAGE_SIZE) return { status: "not_found" };
      }

      return { status: "too_many" };
    },

    async get(learnerId) {
      const { data, error } = await admin.getUserById(learnerId);
      if (error || data.user === null) return null;

      return {
        email: data.user.email ?? null,
        createdAt: data.user.created_at,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      };
    },

    async delete(learnerId) {
      const { error } = await admin.deleteUser(learnerId);
      return { ok: !error };
    },
  };
}

/**
 * What an operator types to delete an account.
 *
 * The learner's pseudonym prefix, not a fixed word: a confirmation anyone can
 * type from memory confirms nothing, and one tied to the learner stops a form
 * left open for one learner from deleting another.
 */
export function deletionPhrase(pseudonym: string): string {
  return `delete ${pseudonym.slice(0, 8)}`;
}

// --- action feedback ------------------------------------------------------------

/** What a learner-support form shows after a submit. */
export interface SupportFormState {
  readonly status: "idle" | "done" | "error";
  readonly message: string;
}

export const SUPPORT_FORM_IDLE: SupportFormState = { status: "idle", message: "" };
