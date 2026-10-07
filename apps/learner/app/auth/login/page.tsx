import { CredentialsForm } from "@/components/auth/credentials-form";
import { QuietPage } from "@/components/site/quiet-page";
import { pageTitle, prose } from "@dp/ui/styles";
import { signInAction } from "@/app/auth/actions";
import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";
import { LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata(LOGIN_PATH);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; deleted?: string | string[] }>;
}) {
  const { next, deleted } = await searchParams;

  return (
    <QuietPage>
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Welcome back</h1>
        <p className={prose}>Sign in to carry on where you left off.</p>
        {deleted === "1" ? (
          <p role="status" className={prose}>
            Your account has been deleted. Thank you for learning with us.
          </p>
        ) : null}
      </div>
      <CredentialsForm
        mode="sign-in"
        action={signInAction}
        initialState={INITIAL_AUTH_STATE}
        next={safeNextPath(next)}
      />
    </QuietPage>
  );
}
