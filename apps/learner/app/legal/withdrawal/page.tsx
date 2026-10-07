import type { Metadata } from "next";
import Link from "next/link";

import { linkInline } from "@dp/ui/styles";

import { LegalPage, LegalSection, legalList } from "@/components/legal/legal-page";
import { WITHDRAWAL_DAYS } from "@/lib/billing/copy";
import { LEGAL_ENTITY, postalAddress } from "@/lib/legal/entity";
import { WITHDRAW_PATH, WITHDRAWAL_PATH } from "@/lib/legal/routes";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = publicPageMetadata(WITHDRAWAL_PATH);

/**
 * The withdrawal instructions (Art. 246a §1(2) EGBGB) and the model
 * withdrawal form (Anlage 2 EGBGB), for a digital service (§356(4) BGB)
 * that starts at the consumer's request (§357a(2) BGB). The order page's
 * consent box refers to this page; the terms link to it; the withdrawal
 * button behind sign-in is the two-step way to send it.
 */
export default function WithdrawalPage() {
  return (
    <LegalPage eyebrow="§355 BGB" title="Right of withdrawal">
      <LegalSection id="right" title="Withdrawal instructions">
        <p>
          You have the right to withdraw from this contract within {WITHDRAWAL_DAYS} days without
          giving any reason. The withdrawal period is {WITHDRAWAL_DAYS} days from the day the
          contract was concluded.
        </p>
        <p>
          To exercise the right of withdrawal, you must inform us ({postalAddress(LEGAL_ENTITY)},
          email {LEGAL_ENTITY.email}) of your decision to withdraw from this contract by an
          unequivocal statement, for example a letter sent by post or an email. You may use the
          model withdrawal form below, but it is not obligatory. Signed in, you can also use the{" "}
          <Link href={WITHDRAW_PATH} className={linkInline}>
            Withdraw from contract
          </Link>{" "}
          button on Plan &amp; billing, which confirms receipt to you straight away.
        </p>
        <p>
          To meet the withdrawal deadline, it is sufficient for you to send your communication
          concerning your exercise of the right of withdrawal before the withdrawal period has
          expired.
        </p>
      </LegalSection>

      <LegalSection id="effects" title="Effects of withdrawal">
        <p>
          If you withdraw from this contract, we shall reimburse to you all payments received from
          you without undue delay and in any event not later than 14 days from the day on which we
          are informed about your decision to withdraw. We will carry out the reimbursement using
          the same means of payment as you used for the initial transaction, unless you have
          expressly agreed otherwise; in any event, you will not incur any fees as a result of the
          reimbursement.
        </p>
        <p>
          If you asked for the service to begin during the withdrawal period, you shall pay us an
          amount which is in proportion to what has been provided until you have communicated to
          us your withdrawal from this contract, in comparison with the full coverage of the
          contract (§357a(2) BGB). A pass or a subscription that started at your request is
          charged for the days used.
        </p>
      </LegalSection>

      <LegalSection id="form" title="Model withdrawal form">
        <p>(Complete and return this form only if you wish to withdraw from the contract.)</p>
        <ul className={legalList}>
          <li>To: {postalAddress(LEGAL_ENTITY)}, email {LEGAL_ENTITY.email}</li>
          <li>
            I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the
            provision of the following service (*): ____________
          </li>
          <li>Ordered on (*) / received on (*): ____________</li>
          <li>Name of consumer(s): ____________</li>
          <li>Address of consumer(s): ____________</li>
          <li>Signature of consumer(s) (only if this form is notified on paper): ____________</li>
          <li>Date: ____________</li>
        </ul>
        <p>(*) Delete as appropriate.</p>
      </LegalSection>
    </LegalPage>
  );
}
