"use client";

import { useActionState, useState } from "react";

import { buttonPrimary, choice, control, field } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import type { OnboardingFormState } from "@/lib/onboarding/form-state";
import {
  CORRECTION_PREFERENCE_OPTIONS,
  INTEREST_OPTIONS,
  LEVEL_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  TOPIC_OPTIONS,
  defaultOnboardingDraft,
  type Option,
} from "@dp/domain/onboarding/defaults";

/**
 * Onboarding.
 *
 * Every answer is tracked in React state and written back to the DOM as a
 * *default* rather than as a value, and that is the whole fix for a form that
 * appeared to fail every time.
 *
 * React resets the DOM form once its action completes, on a refusal as much as
 * on success. A controlled checkbox does not survive that: React will not
 * rewrite a `checked` prop it never saw change, so the answers sat in state
 * while the screen showed an empty form — and a level radio with nothing
 * selected at all, which is not a state a learner could have produced. Filling
 * it in the same way then produced the same refusal, for ever.
 *
 * Binding `defaultChecked` and `defaultValue` to the tracked state instead
 * means the reset restores exactly what the learner had, because the reset's
 * target is the attribute React has been keeping up to date. It also leaves
 * the fields uncontrolled, so the form still submits without JavaScript.
 *
 * Tracking the answers is also what makes the caps enforceable where they can
 * be read: the count is visible while choosing and the remaining options go
 * quiet at the limit, rather than the server refusing after the fact over a
 * rule the form let you break.
 */

const legendClass = "font-display text-sm font-medium text-copy/80";
const hintText = "text-xs text-copy/45";

/** Says where the learner is against the limit, without nagging at zero. */
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
    // The hint is linked to the group, so a screen reader announces the limit
    // and the running count with the question rather than leaving them as
    // loose text nearby.
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
                disabled &&
                  "cursor-not-allowed opacity-40 hover:border-edge/70",
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={checked}
                disabled={disabled}
                onChange={(event) =>
                  onToggle(option.value, event.target.checked)
                }
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

export interface OnboardingFormProps {
  readonly action: (
    state: OnboardingFormState,
    formData: FormData,
  ) => Promise<OnboardingFormState>;
  readonly initialState: OnboardingFormState;
  /** Where to go once set up, carried from sign-up. Validated again on the server. */
  readonly next?: string;
}

export function OnboardingForm({ action, initialState, next }: OnboardingFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [draft, setDraft] = useState(defaultOnboardingDraft());

  /**
   * Records what the box now is, rather than flipping what we thought it was.
   * The input is uncontrolled, so the browser has already decided.
   */
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
    <form action={formAction} className="flex w-full flex-col gap-8">
      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>Where are you now?</legend>
        <p className={hintText}>
          This is your starting preference. Everyone begins at the first
          mini-level; we adjust as we learn how you actually do.
        </p>
        <div className="flex flex-col gap-2">
          {LEVEL_OPTIONS.map((option) => (
            <label key={option.value} className={choice}>
              <input
                type="radio"
                name="selectedLevel"
                value={option.value}
                defaultChecked={draft.selectedLevel === option.value}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    selectedLevel: option.value as typeof current.selectedLevel,
                  }))
                }
                className={cn(control, "mt-1")}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-display text-sm font-medium text-copy">
                  {option.label}
                </span>
                <span className="text-xs text-copy/60">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

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
          placeholder="Order food and chat with my neighbours in Vienna"
          defaultValue={draft.learningGoal}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              learningGoal: event.target.value,
            }))
          }
          className={field}
        />
      </div>

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
        hint={`Choose up to ${MAX_SELECTED_INTERESTS}. We use these to keep conversations interesting.`}
        options={INTEREST_OPTIONS}
        max={MAX_SELECTED_INTERESTS}
        selected={draft.interests}
        onToggle={toggle("interests", MAX_SELECTED_INTERESTS)}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className={legendClass}>How should we correct you?</legend>
        <div className="flex flex-col gap-2">
          {CORRECTION_PREFERENCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(choice, "items-center text-sm")}
            >
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

      {/* Voice arrives in a later phase; text is the mode that always works. */}
      <input
        type="hidden"
        name="inputPreference"
        value={draft.inputPreference}
      />
      <input
        type="hidden"
        name="outputPreference"
        value={draft.outputPreference}
      />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <p
        aria-live="polite"
        role="status"
        className="text-sm text-ember empty:sr-only"
      >
        {state.message}
      </p>

      <button
        type="submit"
        disabled={pending}
        className={cn(buttonPrimary, "self-start")}
      >
        {pending ? "Setting up…" : "Start learning"}
      </button>
    </form>
  );
}
