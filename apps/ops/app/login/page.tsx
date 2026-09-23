import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";

import { signInAction } from "@/app/login/actions";
import { LoginForm } from "@/components/login-form";
import { INITIAL_LOGIN_STATE } from "@/lib/auth/login-state";

export const metadata = { title: "Sign in — Deutsch Partner operations" };

export default function LoginPage() {
  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Operations</h1>
        <p className={prose}>Sign in with your operator account. You will be asked for your authenticator code next.</p>
      </div>
      <LoginForm action={signInAction} initialState={INITIAL_LOGIN_STATE} />
    </QuietShell>
  );
}
