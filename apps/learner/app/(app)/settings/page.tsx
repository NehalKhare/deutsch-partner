import Link from "next/link";

import {
  resetTrainerCoachingAction,
  updateSettingsAction,
} from "@/app/(app)/settings/actions";
import { SettingsForm } from "@/components/settings/settings-form";
import { TrainerCoachingSettings } from "@/components/settings/trainer-coaching";
import { VoiceSourceSetting } from "@/components/settings/voice-source";
import { linkInline, pageTitle, prose } from "@dp/ui/styles";
import { TUTOR } from "@dp/domain/tutor";
import { INITIAL_SETTINGS_STATE } from "@/lib/settings/input";
import { getMiniLevel } from "@dp/learning/mini-levels";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { cn } from "@dp/ui/utils";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createTrainerCoachingRepository } from "@dp/db/trainer-coaching-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Settings" };

/** Section headings as small labels: they name a region, the controls speak. */
const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

const panel = "flex flex-col gap-2.5 rounded-2xl border border-edge/70 bg-panel/50 p-4";

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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:gap-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-0.5">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="text-sm leading-snug text-copy/65">
          Everything here shapes how {TUTOR.name} talks to you.
        </p>
      </header>

      {/* The level as a strip rather than a card: it is not edited here, only
          stated, with the way to where it is edited. */}
      <section
        aria-labelledby="level-heading"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-edge/70 bg-panel/50 px-4 py-2.5"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id="level-heading" className={sectionLabel}>
            Where you are
          </h2>
          {level ? (
            <p className="truncate text-sm text-copy">
              Mini-level {level.miniLevel} ·{" "}
              <span lang="de">{getMiniLevel(level.miniLevel).theme}</span> ·{" "}
              {level.effectiveLevel.cefr}
            </p>
          ) : (
            <p className="text-sm text-copy/60">Your level could not be read just now.</p>
          )}
        </div>
        {/* Your level is position, not preference, so it moves on the
            curriculum page — pick any mini-level there and start from it. */}
        <Link href="/curriculum" className={cn(linkInline, "font-display text-xs")}>
          Change on the curriculum →
        </Link>
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-2">
        <h2 id="profile-heading" className={sectionLabel}>
          How you are taught
        </h2>
        <SettingsForm
          profile={profile.data}
          action={updateSettingsAction}
          initialState={INITIAL_SETTINGS_STATE}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section aria-labelledby="trainer-heading" className={panel}>
          <h2 id="trainer-heading" className={sectionLabel}>
            How your trainer has adapted
          </h2>
          <TrainerCoachingSettings
            profile={coached.ok ? coached.data : null}
            action={resetTrainerCoachingAction}
            initialState={INITIAL_SETTINGS_STATE}
          />
        </section>

        <section aria-labelledby="device-heading" className={panel}>
          <h2 id="device-heading" className={sectionLabel}>
            On this device
          </h2>
          <VoiceSourceSetting />
        </section>
      </div>

      {/* Folded: it is worth being able to find, and not worth a screen of
          every visit. Native <details>, so it opens without JavaScript. */}
      <details className="group rounded-2xl border border-edge/70 bg-panel/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <h2 id="privacy-heading" className={sectionLabel}>
            What is stored
          </h2>
          <span aria-hidden className="font-display text-copy/40 transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <p className="border-t border-edge/50 px-4 py-3 text-sm leading-relaxed text-copy/70">
          Your conversations are not. They live in your browser and end with
          the tab. What the product keeps is what the practice meant: your
          recorded mistakes, your vocabulary progress, a per-level score that
          decides when you move up, and the feedback you give your trainer —
          the votes and any note you add, never the reply they were about.
        </p>
      </details>
    </main>
  );
}
