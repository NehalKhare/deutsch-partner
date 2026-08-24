import { CredentialsForm } from "@/components/auth/credentials-form";
import { QuietShell } from "@/components/site/quiet-shell";
import { pageTitle, prose } from "@/components/ui/styles";
import { signUpAction } from "@/app/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/form-state";

export const metadata = { title: "Create an account — Deutsch Partner" };

export default function SignUpPage() {
  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Start learning German</h1>
        <p className={prose}>Your progress is saved as you go.</p>
      </div>
      <CredentialsForm
        mode="sign-up"
        action={signUpAction}
        initialState={INITIAL_AUTH_STATE}
      />
    </QuietShell>
  );
}
