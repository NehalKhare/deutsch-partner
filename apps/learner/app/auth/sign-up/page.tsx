import { CredentialsForm } from "@/components/auth/credentials-form";
import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";
import { signUpAction } from "@/app/auth/actions";
import { INITIAL_AUTH_STATE } from "@dp/auth/form-state";
import { SIGN_UP_PATH, safeNextPath } from "@/lib/auth/routes";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata = publicPageMetadata(SIGN_UP_PATH);

/**
 * Sign-up, remembering where the visitor was heading — most often the order
 * page for a plan picked on /pricing before there was an account to buy it
 * with.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // A repeated `next` arrives as a list, which names no one destination.
  const destination = typeof next === "string" && next !== "" ? safeNextPath(next) : undefined;

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
        next={destination}
      />
    </QuietShell>
  );
}
