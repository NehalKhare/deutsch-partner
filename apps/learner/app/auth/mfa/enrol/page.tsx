import { redirect } from "next/navigation";

import { verifiedTotpFactor, type MfaClient } from "@dp/auth/mfa";
import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";

import { enrolmentAction } from "@/app/auth/mfa/actions";
import { EnrolForm } from "@/components/auth/enrol-form";
import { INITIAL_ENROLMENT_STATE } from "@/lib/auth/mfa-state";
import { stepUpRedirectTarget } from "@/lib/auth/routes";
import { destinationFromQuery, requireStepUpSession } from "@/lib/auth/step-up";
import { PRIVATE_PAGE_METADATA } from "@/lib/seo/metadata";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export const metadata = { title: "Set up your authenticator", ...PRIVATE_PAGE_METADATA };

export default async function EnrolPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = destinationFromQuery(next);
  await requireStepUpSession(destination);

  // A learner with an authenticator answers it; they do not enrol another.
  const supabase = (await createServerSupabaseClient()) as unknown as MfaClient;
  if (await verifiedTotpFactor(supabase)) redirect(stepUpRedirectTarget(destination ?? "/"));

  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Keep your account yours</h1>
        <p className={prose}>
          Deutsch Partner asks for a code from an authenticator app each time you sign in, so a
          guessed password is not enough to read your conversations.
        </p>
      </div>
      <EnrolForm action={enrolmentAction} initialState={INITIAL_ENROLMENT_STATE} next={destination} />
    </QuietShell>
  );
}
