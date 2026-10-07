import Link from "next/link";

import { buttonPrimary, linkInline, prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { withdrawFromContractAction } from "@/app/(app)/billing/withdraw/actions";
import { NoticeForm } from "@/components/legal/notice-form";
import { requireAuthenticatedAccount } from "@/lib/auth/current-user";
import { WITHDRAWAL_DAYS } from "@/lib/billing/copy";
import { BILLING_PATH } from "@/lib/billing/offers";
import { WITHDRAW_PATH, WITHDRAWAL_PATH } from "@/lib/legal/routes";

export const metadata = { title: "Withdraw from contract" };

/**
 * The §356a BGB withdrawal button, in its two statutory steps.
 *
 * Step one is this page with the button "Withdraw from contract"; step two
 * is the same page with the form and "Withdraw now". A learner who arrives
 * here has the right whether or not anything was ordered in the last 14
 * days: the notice is recorded either way, and whether money is owed back
 * is decided by hand against the order record, never by a form refusing.
 */
export default async function WithdrawPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[] }>;
}) {
  const [account, { step }] = await Promise.all([requireAuthenticatedAccount(), searchParams]);
  const confirming = step === "confirm";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Withdraw from contract
        </h1>
        <p className={cn(prose, "text-sm")}>
          Within {WITHDRAWAL_DAYS} days of an order you can withdraw without giving a reason. Because
          the tutor started at your request, the days used are charged; the rest is refunded. The
          full instructions are on the{" "}
          <Link href={WITHDRAWAL_PATH} className={linkInline}>
            withdrawal page
          </Link>
          .
        </p>
      </header>

      {confirming ? (
        <NoticeForm
          action={withdrawFromContractAction}
          submitLabel="Withdraw now"
          email={account.email ?? undefined}
          contractLabels={{
            subscription: "A subscription I ordered",
            pass: "A pass I bought",
            unknown: "Not sure which",
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Link href={`${WITHDRAW_PATH}?step=confirm`} className={buttonPrimary}>
            Withdraw from contract
          </Link>
          <Link href={BILLING_PATH} className={cn(linkInline, "font-display text-sm")}>
            Back to Plan &amp; billing
          </Link>
        </div>
      )}
    </main>
  );
}
