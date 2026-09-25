import { CredentialsForm } from "@/components/auth/credentials-form";
import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";
import { signUpAction } from "@/app/auth/actions";
import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";
import { SIGN_UP_PATH } from "@/lib/auth/routes";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata(SIGN_UP_PATH);

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
