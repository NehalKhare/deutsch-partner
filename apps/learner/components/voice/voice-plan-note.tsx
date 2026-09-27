"use client";

import { PLAN_CATALOGUE, PLAN_CODES } from "@dp/domain/plans";

import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import type { PlanRefusal } from "@/lib/billing/refusal";

/** The first plan with each AI voice, by name, from the catalogue rather than typed here. */
const VOICE_PLAN = PLAN_CODES.find((code) => PLAN_CATALOGUE[code].features.modelVoice);
const TRAINER_VOICE_PLAN = PLAN_CODES.find((code) => PLAN_CATALOGUE[code].features.trainerVoice);

/**
 * Why the device's voice is reading, when the plan is the reason.
 *
 * One quiet line beside the read-aloud control, never a banner: nothing was
 * lost — the line was read — so this informs and can be put away. A plan
 * without the AI voice is told which plan has it; a learner whose voice lines
 * are spent is told when they come back.
 */
export function VoicePlanNote({
  refusal,
  onDismiss,
  surface = "chat",
}: {
  readonly refusal: PlanRefusal;
  readonly onDismiss: () => void;
  /** Where the lines are read: the Trainer's AI voice comes with a plan of its own. */
  readonly surface?: "chat" | "trainer";
}) {
  const [feature, plan] =
    surface === "trainer" ? ["The AI voice in the Trainer", TRAINER_VOICE_PLAN] : ["The AI voice", VOICE_PLAN];
  const sentence =
    refusal.error === "plan_required"
      ? `Replies are read in your device's voice.${
          plan ? ` ${feature} comes with ${PLAN_CATALOGUE[plan].name}.` : ""
        }`
      : "Today's AI voice lines are used, so your device's voice is reading instead.";

  return (
    <UpgradePrompt refusal={refusal} variant="note" onDismiss={onDismiss}>
      {sentence}
    </UpgradePrompt>
  );
}
