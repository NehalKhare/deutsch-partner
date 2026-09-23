import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle } from "@dp/ui/styles";

import { enrolmentAction } from "@/app/login/actions";
import { EnrolForm } from "@/components/enrol-form";
import { INITIAL_ENROLMENT_STATE } from "@/lib/auth/login-state";
import { requireOperator } from "@/lib/auth/require-operator";

export const metadata = { title: "Set up your authenticator — Deutsch Partner operations" };

export default async function EnrolPage() {
  await requireOperator({ route: "/mfa/enrol", minimumAal: "aal1", audit: false });

  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Set up your authenticator</h1>
      </div>
      <EnrolForm action={enrolmentAction} initialState={INITIAL_ENROLMENT_STATE} />
    </QuietShell>
  );
}
