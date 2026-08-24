import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsForm } from "@/components/settings/settings-form";
import type { LearnerProfile } from "@/domain/learner";
import {
  INITIAL_SETTINGS_STATE,
  SETTINGS_SAVED,
  type SettingsAction,
} from "@/lib/settings/input";
import { MAX_SELECTED_TOPICS, TOPIC_OPTIONS } from "@/lib/onboarding/defaults";

/**
 * The settings form.
 *
 * Two things matter and neither is the markup: it opens showing what is
 * already saved (a settings form that opens blank reads as data loss), and
 * what the learner chose survives the form reset React performs when the
 * action completes.
 */

const PROFILE: LearnerProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  nativeLanguage: "en",
  learningGoal: "Order food and chat with my neighbours in Vienna",
  selectedLevel: "A2",
  targetTopics: ["travel", "food"],
  interests: ["cooking"],
  inputPreference: "text",
  outputPreference: "voice",
  correctionPreference: "explicit",
  voicePreference: "male",
};

const noop: SettingsAction = async () => INITIAL_SETTINGS_STATE;

function renderForm(action: SettingsAction = noop, profile = PROFILE) {
  return render(
    <SettingsForm
      profile={profile}
      action={action}
      initialState={INITIAL_SETTINGS_STATE}
    />,
  );
}

describe("opening", () => {
  it("shows the saved goal, not a blank box", () => {
    renderForm();

    expect(
      screen.getByLabelText(/what do you want to be able to do/i),
    ).toHaveValue(PROFILE.learningGoal);
  });

  it("shows the saved topics as already ticked", () => {
    renderForm();

    expect(screen.getByRole("checkbox", { name: /travel/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /food and eating/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /work and colleagues/i })).not.toBeChecked();
  });

  it("shows the saved correction style selected", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /clearly, with a short/i })).toBeChecked();
  });

  it("shows the saved voice preference", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: "Read aloud" })).toBeChecked();
  });
});

describe("the voice", () => {
  it("shows the saved choice selected", () => {
    renderForm(noop, { ...PROFILE, voicePreference: "female" });

    expect(screen.getByRole("radio", { name: "Female voice" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Male voice" })).not.toBeChecked();
  });

  it("says the name does not change with it", () => {
    renderForm();

    expect(screen.getByText(/stays Jonas either way/i)).toBeInTheDocument();
  });

  it("submits the choice", async () => {
    const seen: FormData[] = [];
    const action: SettingsAction = async (_state, formData) => {
      seen.push(formData);
      return SETTINGS_SAVED;
    };
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole("radio", { name: "Female voice" }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.get("voicePreference")).toBe("female");
  });
});

describe("the caps, enforced where they can be read", () => {
  it("quietens the remaining topics at the limit", async () => {
    const user = userEvent.setup();
    renderForm(noop, {
      ...PROFILE,
      targetTopics: ["travel", "daily_life", "work", "food"],
    });

    // One below the cap of five: tick one more, and the rest must disable.
    await user.click(screen.getByRole("checkbox", { name: /hobbies/i }));

    const remaining = TOPIC_OPTIONS.filter(
      (option) =>
        !["travel", "daily_life", "work", "food", "hobbies"].includes(option.value),
    );
    expect(remaining.length).toBeGreaterThan(0);
    for (const option of remaining) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(option.label, "i") }),
      ).toBeDisabled();
    }
    expect(screen.getByText(new RegExp(`${MAX_SELECTED_TOPICS} chosen`))).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("submits what is on screen and says it saved", async () => {
    const seen: FormData[] = [];
    const action: SettingsAction = async (_state, formData) => {
      seen.push(formData);
      return SETTINGS_SAVED;
    };
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole("checkbox", { name: /cycling/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    });
    // DOM order, not click order: the set is what the schema reads.
    expect(seen[0]?.getAll("interests").sort()).toEqual(["cooking", "cycling"]);
    expect(seen[0]?.get("correctionPreference")).toBe("explicit");
  });

  it("keeps the learner's choices on screen after a refusal", async () => {
    // React resets the DOM form when the action settles. The defaults are
    // bound to tracked state, so the reset restores the choices instead of
    // wiping them.
    const action: SettingsAction = async () => ({
      status: "error",
      message: "Please check your topics and try again.",
    });
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole("checkbox", { name: /cycling/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(screen.getByRole("checkbox", { name: /cycling/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /travel/i })).toBeChecked();
  });
});
