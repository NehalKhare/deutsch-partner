import { CredentialsForm } from "@/components/auth/credentials-form";
import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";
import { signInAction } from "@/app/auth/actions";
import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";
import { safeNextPath } from "@/lib/auth/routes";

export const metadata = { title: "Sign in — Deutsch Partner" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <QuietShell>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Welcome back</h1>
        <p className={prose}>Sign in to carry on where you left off.</p>
      </div>
      <CredentialsForm
        mode="sign-in"
        action={signInAction}
        initialState={INITIAL_AUTH_STATE}
        next={safeNextPath(next)}
      />
    </QuietShell>
  );
}
