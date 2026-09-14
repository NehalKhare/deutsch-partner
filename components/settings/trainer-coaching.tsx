"use client";

import { useActionState } from "react";

import { buttonQuiet } from "@/components/ui/styles";
import { isDefaultCoaching, type TrainerCoachingProfile } from "@/domain/trainer-coaching";
import { describeDials } from "@/lib/trainer/coaching";
import type { SettingsFormState } from "@/lib/settings/input";
import { cn } from "@/lib/utils";

/**
 * What the trainer has learned about coaching this learner, and the door out.
 *
 * Guardrails S15: anything the product remembers about a learner, the learner
 * can inspect and clear. The dials are listed in the same words the session
 * uses, the votes are counted, and one button forgets all of it — the dials
 * and every vote behind them — so the next session starts from the defaults.
 */
export function TrainerCoachingSettings({
  profile,
  action,
  initialState,
}: {
  /** Null for a learner who has never given the trainer feedback. */
  readonly profile: TrainerCoachingProfile | null;
  readonly action: (state: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
  readonly initialState: SettingsFormState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const tuned = profile !== null && !isDefaultCoaching(profile);
  const votes = profile === null ? 0 : profile.helpfulCount + profile.unhelpfulCount;

  return (
    <div className="flex flex-col gap-3" data-role="trainer-coaching">
      {tuned ? (
        <p className="leading-relaxed text-chalk/70">
          From your feedback, your trainer now gives you{" "}
          <span className="text-chalk">{describeDials(profile).join(", ")}</span>.
        </p>
      ) : (
        <p className="leading-relaxed text-chalk/70">
          Your trainer is on its default settings. Rate its replies during a
          session, or just ask it — for shorter explanations, harder exercises,
          a grammar focus — and it adjusts from then on.
        </p>
      )}
      {votes > 0 ? (
        <p className="text-xs text-chalk/45">
          Learned from {votes} {votes === 1 ? "vote" : "votes"}
          {profile !== null && profile.disputedCorrections > 0
            ? `, including ${profile.disputedCorrections} disputed ${
                profile.disputedCorrections === 1 ? "correction" : "corrections"
              }`
            : ""}
          .
        </p>
      ) : null}

      {profile !== null ? (
        <form action={formAction} className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className={cn(buttonQuiet, "px-4 py-2 text-sm")}
          >
            {pending ? "Forgetting…" : "Forget my feedback"}
          </button>
          {state.message ? (
            <p
              role="status"
              className={cn("text-xs", state.status === "error" ? "text-ember" : "text-chalk/55")}
            >
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
