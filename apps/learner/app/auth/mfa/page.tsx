import { redirect } from "next/navigation";

import { verifiedTotpFactor, type MfaClient } from "@dp/auth/mfa";
import { QuietPage } from "@/components/site/quiet-page";
import { pageTitle, prose } from "@dp/ui/styles";

import { verifyMfaAction } from "@/app/auth/mfa/actions";
import { CodeForm } from "@/components/auth/code-form";
import { INITIAL_CODE_STATE } from "@/lib/auth/mfa-state";
import { enrolRedirectTarget } from "@/lib/auth/routes";
import { destinationFromQuery, requireStepUpSession } from "@/lib/auth/step-up";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo/metadata";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export const metadata = { title: "One more step", ...PRIVATE_PAGE_METADATA };

/**
 * Deliberately outside the (app) segment: that layout requires the second
 * factor, which is the very thing this page exists to collect.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = destinationFromQuery(next);
  // A password-only session may stand here, and nobody else.
  await requireStepUpSession(destination);

  // An account with nothing to answer sets an authenticator up instead.
  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  if (!(await verifiedTotpFactor(supabase))) redirect(enrolRedirectTarget(destination ?? "/"));

  return (
    <QuietPage>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>One more step</h1>
        <p className={prose}>Enter the code from your authenticator app.</p>
      </div>
      <CodeForm action={verifyMfaAction} initialState={INITIAL_CODE_STATE} next={destination} />
    </QuietPage>
  );
}
