"use server";

import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { parseNoticeForm, noticeError, sendNotice, type NoticeFormState } from "@/lib/legal/notices";
import { createNoticeDeps } from "@/lib/legal/server";

/**
 * "Withdraw now" (§356a BGB): the second of the two steps. Behind sign-in
 * because an account was needed to contract, so the learner is known, and
 * the notice is theirs on Plan & billing afterwards.
 */
export async function withdrawFromContractAction(
  _previous: NoticeFormState,
  formData: FormData,
): Promise<NoticeFormState> {
  const learnerId = await requireAuthenticatedUserId();

  const form = parseNoticeForm({
    email: formData.get("email"),
    contract: formData.get("contract"),
    detail: formData.get("detail"),
  });
  if (!form.ok) return noticeError(form.error);

  return sendNotice("withdrawal", form.data, learnerId, createNoticeDeps());
}
