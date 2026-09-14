import Link from "next/link";

import {
  resetTrainerCoachingAction,
  updateSettingsAction,
} from "@/app/(app)/settings/actions";
import { SettingsForm } from "@/components/settings/settings-form";
import { TrainerCoachingSettings } from "@/components/settings/trainer-coaching";
import { VoiceSourceSetting } from "@/components/settings/voice-source";
import {
  card,
  eyebrow,
  linkInline,
  pageTitle,
  prose,
  sectionTitle,
} from "@/components/ui/styles";
import { TUTOR } from "@/domain/tutor";
import { INITIAL_SETTINGS_STATE } from "@/lib/settings/input";
import { getMiniLevel } from "@/learning/mini-levels";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { cn } from "@/lib/utils";
import { createLearnerRepository } from "@/repositories/learner-repository";
import { createTrainerCoachingRepository } from "@/repositories/trainer-coaching-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

export const metadata = { title: "Settings — Deutsch Partner" };

/**
 * Profile settings.
 *
 * Everything the tutor is told about this learner, editable in one place —
 * plus the doors that belong near it: the level (which lives on the
 * curriculum page, where moving means something), and for operators, the AI
 * spend dashboard.
 *
 * The operator section renders only for operators. A locked door with a label
 * on it tells everyone else there is a room worth finding.
 */
export default async function SettingsPage() {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);
  const coaching = createTrainerCoachingRepository(supabase);

  const [profile, state, coached] = await Promise.all([
    learners.getProfile(learnerId),
    learners.getState(learnerId),
    coaching.getProfile(learnerId),
  ]);

  if (!profile.ok) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12 md:px-10">
        <h1 className={pageTitle}>Settings</h1>
        <p className={cn(prose, "mt-4")}>
          Your profile could not be loaded. Please refresh and try again.
        </p>
      </main>
    );
  }

  const level = state.ok ? state.data : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-3">
        <p className={eyebrow}>Your profile</p>
        <h1 className={pageTitle}>Settings</h1>
        <p className={cn(prose, "max-w-xl")}>
          Everything here shapes how {TUTOR.name} talks to you — what he
          corrects, what he brings up, and how fast he expects you to keep up.
        </p>
      </header>

      <section aria-labelledby="level-heading" className={cn(card, "flex flex-col gap-2")}>
        <h2 id="level-heading" className={sectionTitle}>
          Where you are
        </h2>
        {level ? (
          <p className={prose}>
            Mini-level <strong className="text-chalk">{level.miniLevel}</strong> —{" "}
            <span lang="de">{getMiniLevel(level.miniLevel).theme}</span>, which is{" "}
            {level.effectiveLevel.cefr}.
          </p>
        ) : (
          <p className={prose}>Your level could not be read just now.</p>
        )}
        <p className="text-sm text-chalk/55">
          Your level is position, not preference, so it moves on the{" "}
          <Link href="/curriculum" className={linkInline}>
            curriculum page
          </Link>
          {" "}— pick any mini-level there and start from it.
        </p>
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-5">
        <h2 id="profile-heading" className={sectionTitle}>
          How you are taught
        </h2>
        <SettingsForm
          profile={profile.data}
          action={updateSettingsAction}
          initialState={INITIAL_SETTINGS_STATE}
        />
      </section>

      <section
        aria-labelledby="trainer-heading"
        className={cn(card, "flex flex-col gap-3")}
      >
        <h2 id="trainer-heading" className={sectionTitle}>
          How your trainer has adapted
        </h2>
        <TrainerCoachingSettings
          profile={coached.ok ? coached.data : null}
          action={resetTrainerCoachingAction}
          initialState={INITIAL_SETTINGS_STATE}
        />
      </section>

      <section
        aria-labelledby="device-heading"
        className={cn(card, "flex flex-col gap-4")}
      >
        <h2 id="device-heading" className={sectionTitle}>
          On this device
        </h2>
        <VoiceSourceSetting />
      </section>

      <section aria-labelledby="privacy-heading" className={cn(card, "flex flex-col gap-2")}>
        <h2 id="privacy-heading" className={sectionTitle}>
          What is stored
        </h2>
        <p className={prose}>
          Your conversations are not. They live in your browser and end with
          the tab. What the product keeps is what the practice meant: your
          recorded mistakes, your vocabulary progress, a per-level score that
          decides when you move up, and the feedback you give your trainer —
          the votes and any note you add, never the reply they were about.
        </p>
      </section>
    </main>
  );
}
