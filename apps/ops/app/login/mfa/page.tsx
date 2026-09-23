import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";

import { verifyMfaAction } from "@/app/login/actions";
import { CodeForm } from "@/components/code-form";
import { INITIAL_LOGIN_STATE } from "@/lib/auth/login-state";
import { requireOperator } from "@/lib/auth/require-operator";

export const metadata = { title: "Second factor — Deutsch Partner operations" };

export default async function MfaPage() {
  // A password-only session may stand here, and nobody else.
  await requireOperator({ route: "/login/mfa", minimumAal: "aal1", audit: false });

  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>One more step</h1>
        <p className={prose}>Enter the code from your authenticator app.</p>
      </div>
      <CodeForm action={verifyMfaAction} initialState={INITIAL_LOGIN_STATE} />
    </QuietShell>
  );
}
