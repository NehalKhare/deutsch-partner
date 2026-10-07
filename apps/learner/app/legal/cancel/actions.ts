"use server";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { parseNoticeForm, noticeError, sendNotice, type NoticeFormState } from "@/lib/legal/notices";
import { createNoticeDeps } from "@/lib/legal/server";

/**
 * "Cancel now" (§312k BGB). No session needed; if there happens to be one,
 * the notice is attached to it as well, so Plan & billing can show it back.
 */
export async function cancelContractAction(
  _previous: NoticeFormState,
  formData: FormData,
): Promise<NoticeFormState> {
  const form = parseNoticeForm({
    email: formData.get("email"),
    contract: formData.get("contract"),
    detail: formData.get("detail"),
  });
  if (!form.ok) return noticeError(form.error);

  const learnerId = await getAuthenticatedUserId();
  return sendNotice("cancellation", form.data, learnerId, createNoticeDeps());
}
