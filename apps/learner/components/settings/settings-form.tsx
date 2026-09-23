"use client";

import { useActionState, useState } from "react";

import { buttonPrimary, choice, control, field } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  MASTERY_THRESHOLDS,
  type LearnerProfile,
  type MasteryThreshold,
  type TrainerPersonality,
} from "@dp/domain/learner";
import { TUTOR } from "@dp/domain/tutor";
import type { SettingsAction, SettingsFormState } from "@/lib/settings/input";
import {
  CORRECTION_PREFERENCE_OPTIONS,
  INTEREST_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  TOPIC_OPTIONS,
  type Option,
} from "@dp/domain/onboarding/defaults";

/**
 * The profile settings, editable.
 *
 * The same discipline as onboarding, for the same reason: React resets the
 * DOM form when its action completes, and a controlled checkbox does not
 * survive that — the reset empties it and no state changed, so nothing
 * re-renders to put it back. Every answer is tracked in state and written
 * back as a *default*, so the reset restores exactly what the learner chose.
 *
 * The tracked state starts from the saved profile rather than from blank,
 * because a settings form that opens empty reads as data loss.
 *
 * Which leaves one thing that cost a bug report: a default is read when an
 * input mounts, and state initialised from a prop ignores every later value
 * of it. So a save that stored "explicit" and refreshed the page put the
 * stored profile in the props and changed nothing on screen — the form went
 * on showing what it was built with, and looked for all the world as though
 * saving did nothing. The fields therefore live in their own component,
 * keyed by the stored profile: when the stored values change, they are built
 * again from the new ones. The key is deliberately not on the form itself,
 * which holds the action's "Saved." message and must survive.
 */

/** The saved profile, as the form holds it while it is being edited. */
function draftFrom(profile: LearnerProfile) {
  return {
    learningGoal: profile.learningGoal,
    targetTopics: profile.targetTopics,
    interests: profile.interests,
    inputPreference: profile.inputPreference,
    outputPreference: profile.outputPreference,
    correctionPreference: profile.correctionPreference,
    voicePreference: profile.voicePreference,
    trainerPersonality: profile.trainerPersonality,
    masteryThreshold: profile.masteryThreshold,
  };
}

/**
 * The two manners the trainer can take, in the learner's words.
 *
 * Each detail names what changes — tone, praise, how an error is put — and
 * the fieldset says what does not: the material, the agenda and the
 * judgement are the same trainer either way.
 */
const TRAINER_PERSONALITY_OPTIONS: ReadonlyArray<{
  readonly value: TrainerPersonality;
  readonly label: string;
  readonly detail: string;
}> = [
  {
    value: "friendly",
    label: "Friendly",
    detail:
      "Warm and encouraging. Notices what went right before fixing what did not, and keeps the mood light.",
  },
  {
    value: "strict",
    label: "Strict",
    detail:
      "Exacting and to the point. Names every error, praises nothing routine, and expects precision.",
  },
];

const legendClass = "font-display text-sm font-medium text-copy/80";
const hintText = "text-xs text-copy/45";

/** What each pass mark is called when the slider stands on it. */
const THRESHOLD_LABELS: Readonly<Record<MasteryThreshold, string>> = {
  33: "Relaxed",
  50: "Balanced",
  80: "Thorough",
};

function countHint(chosen: number, max: number): string {
  if (chosen === 0) return "";
  if (chosen < max) return `${chosen} chosen.`;
  return `${chosen} chosen — untick one to choose another.`;
}

function CheckboxGroup({
  name,
  legend,
  hint,
  options,
  max,
  selected,
  onToggle,
}: {
  name: string;
  legend: string;
  hint: string;
  options: readonly Option[];
  max: number;
  selected: readonly string[];
  onToggle: (value: string, checked: boolean) => void;
}) {
  const hintId = `${name}-hint`;
  const full = selected.length >= max;

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={hintId}>
      <legend className={legendClass}>{legend}</legend>
      <p id={hintId} className={hintText}>
        {`${hint} ${countHint(selected.length, max)}`.trim()}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          const disabled = full && !checked;

          return (
            <label
              key={option.value}
              className={cn(
                choice,
                "items-center rounded-full px-3.5 py-1.5 text-sm",
                disabled && "cursor-not-allowed opacity-40 hover:border-edge/70",
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={checked}
                disabled={disabled}
                onChange={(event) => onToggle(option.value, event.target.checked)}
                className={control}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SettingsForm({
  profile,
  action,
  initialState,
}: {
  readonly profile: LearnerProfile;
  readonly action: SettingsAction;
  readonly initialState: SettingsFormState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // The stored values, not the object holding them: every server render sends
  // a new object, and remounting the fields on each one would throw away an
  // edit in progress. Rebuilt only when what is stored actually differs.
  const stored = JSON.stringify(draftFrom(profile));

  return (
    <form action={formAction} className="flex w-full flex-col gap-8">
      <SettingsFields key={stored} profile={profile} />

      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-sm empty:sr-only",
            state.status === "error" ? "text-ember" : "text-sprout",
          )}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}

/** Everything the learner edits, built from the profile it is keyed by. */
function SettingsFields({ profile }: { readonly profile: LearnerProfile }) {
  const [draft, setDraft] = useState(() => draftFrom(profile));

  const toggle =
    (key: "targetTopics" | "interests", max: number) =>
    (value: string, checked: boolean) =>
      setDraft((current) => {
        const chosen = current[key];
        if (!checked) {
          return { ...current, [key]: chosen.filter((v) => v !== value) };
        }
        if (chosen.includes(value) || chosen.length >= max) return current;
        return { ...current, [key]: [...chosen, value] };
      });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="learningGoal" className={legendClass}>
          What do you want to be able to do?
        </label>
        <textarea
          id="learningGoal"
          name="learningGoal"
          required
          maxLength={500}
          rows={3}
          defaultValue={draft.learningGoal}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              learningGoal: event.target.value,
            }))
          }
          className={field}
        />
        <p className={hintText}>
          The tutor reads this before every reply, so keep it concrete.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>How should {TUTOR.name} correct you?</legend>
        <div className="flex flex-col gap-2">
          {CORRECTION_PREFERENCE_OPTIONS.map((option) => (
            <label key={option.value} className={cn(choice, "items-center text-sm")}>
              <input
                type="radio"
                name="correctionPreference"
                value={option.value}
                defaultChecked={draft.correctionPreference === option.value}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    correctionPreference:
                      option.value as typeof current.correctionPreference,
                  }))
                }
                className={control}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>How your trainer treats you</legend>
        <p className={hintText}>
          Manner only: the same agenda, the same material, and the same
          judgement of your answers, delivered in a different tone.
        </p>
        <div className="flex flex-col gap-2">
          {TRAINER_PERSONALITY_OPTIONS.map((option) => (
            <label key={option.value} className={cn(choice, "items-start text-sm")}>
              <input
                type="radio"
                name="trainerPersonality"
                value={option.value}
                defaultChecked={draft.trainerPersonality === option.value}
                onChange={() =>
                  setDraft((current) => ({ ...current, trainerPersonality: option.value }))
                }
                className={cn(control, "mt-0.5")}
              />
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-xs text-copy/45">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* A slider over three positions rather than a free percentage: each
          stop is a stance on how to learn, and the gate can explain a stance.
          The submitted value is the percent itself, carried by the hidden
          field, so the wire format is meaningful and the slider stays UI. */}
      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>How high is the bar to move up?</legend>
        <p id="masteryThreshold-hint" className={hintText}>
          The share of your evaluated turns that must be error-free before a
          mini-level counts as cleared. At least five turns are needed,
          whatever you choose.
        </p>
        <input
          type="range"
          min={0}
          max={MASTERY_THRESHOLDS.length - 1}
          step={1}
          value={Math.max(0, MASTERY_THRESHOLDS.indexOf(draft.masteryThreshold))}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              masteryThreshold:
                MASTERY_THRESHOLDS[Number(event.target.value)] ?? 80,
            }))
          }
          aria-label="Pass mark for moving up"
          aria-describedby="masteryThreshold-hint"
          aria-valuetext={`${THRESHOLD_LABELS[draft.masteryThreshold]} — ${draft.masteryThreshold}% of turns error-free`}
          className="w-full max-w-xs accent-brand"
        />
        <p className="text-sm text-copy/70" aria-hidden>
          {MASTERY_THRESHOLDS.map((value, index) => (
            <span key={value}>
              {index > 0 ? " · " : ""}
              <span
                className={cn(
                  draft.masteryThreshold === value
                    ? "font-semibold text-brand"
                    : "text-copy/45",
                )}
              >
                {THRESHOLD_LABELS[value]} {value}%
              </span>
            </span>
          ))}
        </p>
        <input type="hidden" name="masteryThreshold" value={draft.masteryThreshold} />
      </fieldset>

      <CheckboxGroup
        name="targetTopics"
        legend="What should we talk about?"
        hint={`Choose up to ${MAX_SELECTED_TOPICS}.`}
        options={TOPIC_OPTIONS}
        max={MAX_SELECTED_TOPICS}
        selected={draft.targetTopics}
        onToggle={toggle("targetTopics", MAX_SELECTED_TOPICS)}
      />

      <CheckboxGroup
        name="interests"
        legend="What are you into?"
        hint={`Choose up to ${MAX_SELECTED_INTERESTS}. Conversations lean on these.`}
        options={INTEREST_OPTIONS}
        max={MAX_SELECTED_INTERESTS}
        selected={draft.interests}
        onToggle={toggle("interests", MAX_SELECTED_INTERESTS)}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-3">
          <legend className={legendClass}>You prefer to answer by</legend>
          <div className="flex gap-2">
            {(["text", "voice"] as const).map((mode) => (
              <label
                key={mode}
                className={cn(choice, "items-center rounded-full px-3.5 py-1.5 text-sm")}
              >
                <input
                  type="radio"
                  name="inputPreference"
                  value={mode}
                  defaultChecked={draft.inputPreference === mode}
                  onChange={() =>
                    setDraft((current) => ({ ...current, inputPreference: mode }))
                  }
                  className={control}
                />
                {mode === "text" ? "Typing" : "Speaking"}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className={legendClass}>Replies should arrive as</legend>
          <div className="flex gap-2">
            {(["text", "voice"] as const).map((mode) => (
              <label
                key={mode}
                className={cn(choice, "items-center rounded-full px-3.5 py-1.5 text-sm")}
              >
                <input
                  type="radio"
                  name="outputPreference"
                  value={mode}
                  defaultChecked={draft.outputPreference === mode}
                  onChange={() =>
                    setDraft((current) => ({ ...current, outputPreference: mode }))
                  }
                  className={control}
                />
                {mode === "text" ? "Text" : "Read aloud"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>How the tutor sounds</legend>
        <p className={hintText}>
          Applies to read-aloud replies. {TUTOR.name} stays {TUTOR.name} either
          way — this only changes the voice.
        </p>
        <div className="flex gap-2">
          {([
            ["male", "Male voice"],
            ["female", "Female voice"],
          ] as const).map(([value, label]) => (
            <label
              key={value}
              className={cn(choice, "items-center rounded-full px-3.5 py-1.5 text-sm")}
            >
              <input
                type="radio"
                name="voicePreference"
                value={value}
                defaultChecked={draft.voicePreference === value}
                onChange={() =>
                  setDraft((current) => ({ ...current, voicePreference: value }))
                }
                className={control}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

    </>
  );
}
