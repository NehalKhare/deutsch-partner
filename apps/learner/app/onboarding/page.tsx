import { completeOnboardingAction } from "@/app/onboarding/actions";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { QuietShell } from "@dp/ui/quiet-shell";
import { pageTitle, prose } from "@dp/ui/styles";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { INITIAL_ONBOARDING_STATE } from "@/lib/onboarding/form-state";
import { redirectIfOnboarded } from "@/lib/onboarding/gate";

export const metadata = { title: "Set up — Deutsch Partner" };

/**
 * Deliberately outside the (app) segment: that layout requires a completed
 * profile, which is the very thing this page exists to create.
 */
export default async function OnboardingPage() {
  const learnerId = await requireAuthenticatedUserId();
  await redirectIfOnboarded(learnerId);

  return (
    <QuietShell width="wide">
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Let&rsquo;s set you up</h1>
        <p className={prose}>
          A few questions so your partner knows how to talk to you. You can
          change any of this later.
        </p>
      </div>

      <OnboardingForm
        action={completeOnboardingAction}
        initialState={INITIAL_ONBOARDING_STATE}
      />
    </QuietShell>
  );
}
