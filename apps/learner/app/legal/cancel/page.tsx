import type { Metadata } from "next";

import { prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { cancelContractAction } from "@/app/legal/cancel/actions";
import { LegalPage } from "@/components/legal/legal-page";
import { NoticeForm } from "@/components/legal/notice-form";
import { getAuthenticatedAccount } from "@/lib/auth/current-user";
import { CANCEL_CONTRACT_PATH } from "@/lib/legal/routes";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = publicPageMetadata(CANCEL_CONTRACT_PATH);

/**
 * The §312k BGB cancellation page: reached from "Cancel contracts here" in
 * every footer, holding only what the law lists — who, which contract, and
 * the "Cancel now" button. No sign-in, no reason, no offer to stay. A pass
 * can be cancelled here too; it does not renew, so cancelling one changes
 * nothing, and the record still says the consumer asked.
 */
export default async function CancelContractPage() {
  const account = await getAuthenticatedAccount();

  return (
    <LegalPage eyebrow="§312k BGB" title="Cancel contracts here">
      <p className={cn(prose, "text-sm")}>
        Cancel a subscription or a pass. You do not need to sign in. Press “Cancel now” and the
        notice counts from this moment; your plan runs to the end of what you have paid for and is
        not charged again.
      </p>
      <NoticeForm
        action={cancelContractAction}
        submitLabel="Cancel now"
        email={account?.email ?? undefined}
        contractLabels={{
          subscription: "A subscription (monthly or yearly)",
          pass: "A pass",
          unknown: "Not sure",
        }}
      />
    </LegalPage>
  );
}
