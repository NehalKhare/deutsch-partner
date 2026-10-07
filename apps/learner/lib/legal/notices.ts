import { randomBytes } from "node:crypto";

import { z } from "zod";

import type {
  ContractNotice,
  ContractNoticesRepository,
  NoticeContract,
  NoticeKind,
} from "@dp/db/contract-notices-repository";
import type { RateLimiter } from "@dp/db/rate-limit-repository";
import type { Logger } from "@dp/observability/logger";

/**
 * Cancelling a contract (§312k BGB) and withdrawing from one (§356a BGB).
 *
 * Both are notices: a consumer says so, we record when, and we confirm it in
 * text form. The two buttons differ in who may press them — cancellation
 * works without signing in, withdrawal sits behind it — and in nothing else,
 * so one module decides both: what the form must say, what is refused, and
 * what is written. The actions in app/ only read the session and hand over.
 *
 * What is deliberately absent: a retention offer, a reason field that must
 * be filled, a sign-in wall on cancellation, and any difference between a
 * subscription and a pass (BGH I ZR 161/24). Pressing the button is the
 * whole procedure.
 */

export const NOTICE_ERRORS = {
  invalid_email: "Please enter the email address of your account, so we can confirm the notice to it.",
  invalid_contract: "Please say whether it is a subscription or a pass, or choose “not sure”.",
  detail_too_long: "Please keep the description under 500 characters.",
  rate_limited: "That was a lot of notices in a short time. Please wait a few minutes and try again.",
  unavailable: "We could not record your notice just now. Please try again, or email us; the date you first tried counts.",
} as const;

export type NoticeError = keyof typeof NOTICE_ERRORS;

export interface NoticeFormState {
  readonly status: "idle" | "error" | "done";
  readonly message: string | null;
  /** Set once recorded: what the confirmation page shows and the consumer keeps. */
  readonly receipt: NoticeReceipt | null;
}

export interface NoticeReceipt {
  readonly reference: string;
  readonly kind: NoticeKind;
  readonly email: string;
  readonly contract: NoticeContract;
  readonly receivedAt: string;
  /** False until an email sender exists: the page says so, and is the record. */
  readonly emailed: boolean;
}

export const INITIAL_NOTICE_STATE: NoticeFormState = { status: "idle", message: null, receipt: null };

export function noticeError(error: NoticeError): NoticeFormState {
  return { status: "error", message: NOTICE_ERRORS[error], receipt: null };
}

const formSchema = z.object({
  email: z.email().max(254),
  contract: z.enum(["subscription", "pass", "unknown"]),
  detail: z.string().trim().max(500),
});

export type ParsedNoticeForm = z.infer<typeof formSchema>;

export type ParsedNotice =
  | { readonly ok: true; readonly data: ParsedNoticeForm }
  | { readonly ok: false; readonly error: NoticeError };

/** The form, as either button sends it. The address is required because the confirmation goes to it. */
export function parseNoticeForm(input: {
  readonly email: unknown;
  readonly contract: unknown;
  readonly detail: unknown;
}): ParsedNotice {
  const email = z.email().max(254).safeParse(String(input.email ?? "").trim().toLowerCase());
  if (!email.success) return { ok: false, error: "invalid_email" };
  const contract = formSchema.shape.contract.safeParse(input.contract ?? "unknown");
  if (!contract.success) return { ok: false, error: "invalid_contract" };
  const detail = formSchema.shape.detail.safeParse(String(input.detail ?? ""));
  if (!detail.success) return { ok: false, error: "detail_too_long" };
  return { ok: true, data: { email: email.data, contract: contract.data, detail: detail.data } };
}

/** Unambiguous characters only: a reference is read out over the phone and typed back. */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function mintReference(random: (bytes: number) => Uint8Array = (n) => randomBytes(n)): string {
  const bytes = random(10);
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return out;
}

/**
 * Sends the text-form confirmation (§312k(4), §356a(3) BGB).
 *
 * There is no email sender in this product yet (spec S11), so the only
 * implementation marks nothing sent and the confirmation page stands in: it
 * carries the reference, the time and the address, and tells the consumer to
 * keep it. When a sender exists it implements this, and the page's wording
 * follows `emailed`.
 */
export interface NoticeConfirmer {
  send(notice: ContractNotice): Promise<{ readonly sent: boolean }>;
}

export const NO_SENDER: NoticeConfirmer = {
  async send() {
    return { sent: false };
  },
};

export interface NoticeDeps {
  readonly notices: ContractNoticesRepository;
  readonly confirmer: NoticeConfirmer;
  readonly limiter: RateLimiter;
  /** A keyed hash of the address, so the limit is per sender and the log holds no address. */
  readonly keyFor: (email: string) => string;
  readonly logger: Logger;
  readonly now: () => Date;
}

export async function sendNotice(
  kind: NoticeKind,
  form: ParsedNoticeForm,
  learnerId: string | null,
  deps: NoticeDeps,
): Promise<NoticeFormState> {
  const key = deps.keyFor(form.email);
  const decision = await deps.limiter.check(key);
  if (!decision.allowed) return noticeError("rate_limited");

  const recorded = await deps.notices.record({
    reference: mintReference(),
    kind,
    email: form.email,
    contract: form.contract,
    detail: form.detail === "" ? null : form.detail,
    learnerId,
  });
  if (!recorded.ok) {
    deps.logger.error("legal.notice_failed", { kind, senderHash: key, code: recorded.error.kind });
    return noticeError("unavailable");
  }
  const notice = recorded.data;

  let sent = false;
  try {
    sent = (await deps.confirmer.send(notice)).sent;
  } catch {
    sent = false;
  }
  if (sent) await deps.notices.markConfirmed(notice.reference, deps.now());

  deps.logger.info("legal.notice_received", {
    audit: true,
    kind,
    contract: notice.contract,
    reference: notice.reference,
    senderHash: key,
    confirmed: sent,
  });

  return {
    status: "done",
    message: null,
    receipt: {
      reference: notice.reference,
      kind,
      email: notice.email,
      contract: notice.contract,
      receivedAt: notice.receivedAt.toISOString(),
      emailed: sent,
    },
  };
}
