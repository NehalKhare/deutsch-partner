import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsForm } from "@/components/settings/settings-form";
import type { LearnerProfile } from "@dp/domain/learner";
import {
  INITIAL_SETTINGS_STATE,
  SETTINGS_SAVED,
  type SettingsAction,
} from "@/lib/settings/input";
import { MAX_SELECTED_TOPICS, TOPIC_OPTIONS } from "@dp/domain/onboarding/defaults";

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
  learningGoal: "Order food and chat with my neighbours in Vienna",
  selectedLevel: "A2",
  targetTopics: ["travel", "food"],
  interests: ["cooking"],
  inputPreference: "text",
  outputPreference: "voice",
  correctionPreference: "explicit",
  voicePreference: "male",
  trainerPersonality: "friendly",
  masteryThreshold: 80,
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

  it("says which tutor each voice is", () => {
    renderForm();

    expect(screen.getByText(/male voice is Jonas/i)).toBeInTheDocument();
    expect(screen.getByText(/female voice is Alex/i)).toBeInTheDocument();
  });

  it("names the tutor the saved voice belongs to", () => {
    renderForm(noop, { ...PROFILE, voicePreference: "female" });

    expect(screen.getByText(/How should Alex correct you/i)).toBeInTheDocument();
  });

  it("renames the tutor as soon as the other voice is picked, before saving", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByText(/How should Jonas correct you/i)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Female voice" }));

    expect(screen.getByText(/How should Alex correct you/i)).toBeInTheDocument();
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

describe("the trainer's personality", () => {
  it("shows the saved choice selected", () => {
    renderForm(noop, { ...PROFILE, trainerPersonality: "strict" });

    expect(screen.getByRole("radio", { name: /^strict/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^friendly/i })).not.toBeChecked();
  });

  it("says what each personality changes, and what it does not", () => {
    renderForm();

    // Manner, not material: a strict trainer runs the same session.
    expect(screen.getByText(/same agenda|same material|what it covers/i)).toBeInTheDocument();
  });

  it("submits the choice", async () => {
    const seen: FormData[] = [];
    const action: SettingsAction = async (_state, formData) => {
      seen.push(formData);
      return SETTINGS_SAVED;
    };
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole("radio", { name: /^strict/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.get("trainerPersonality")).toBe("strict");
  });
});

describe("the pass mark", () => {
  it("shows the saved mark on the slider", () => {
    renderForm(noop, { ...PROFILE, masteryThreshold: 50 });

    const slider = screen.getByRole("slider", { name: /pass mark/i });
    expect(slider).toHaveValue("1");
    expect(slider).toHaveAccessibleDescription(/error-free/i);
  });

  it("submits the percent itself, not the slider's position", async () => {
    const seen: FormData[] = [];
    const action: SettingsAction = async (_state, formData) => {
      seen.push(formData);
      return SETTINGS_SAVED;
    };
    const user = userEvent.setup();
    renderForm(action);

    const slider = screen.getByRole("slider", { name: /pass mark/i });
    fireEvent.change(slider, { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.get("masteryThreshold")).toBe("33");
  });

  it("says the seven-turn minimum survives every setting", () => {
    renderForm();

    expect(screen.getByText(/at least seven turns/i)).toBeInTheDocument();
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

  it("keeps the chosen correction style on screen after a save", async () => {
    // The reported bug: change a radio, save, and the form shows the old
    // choice again — so the setting looks as though it never saved.
    const action: SettingsAction = async () => SETTINGS_SAVED;
    const user = userEvent.setup();
    renderForm(action);

    await user.click(screen.getByRole("radio", { name: /gently/i }));
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    });
    expect(screen.getByRole("radio", { name: /gently/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /clearly/i })).not.toBeChecked();
  });

  it("keeps the chosen pass mark on screen after a save", async () => {
    const action: SettingsAction = async () => SETTINGS_SAVED;
    const user = userEvent.setup();
    const { container } = renderForm(action);

    fireEvent.change(screen.getByLabelText(/pass mark for moving up/i), {
      target: { value: "0" },
    });
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    });
    expect(
      container.querySelector("input[name='masteryThreshold']"),
    ).toHaveValue("33");
  });

  it("submits the same pass mark again when saved twice", async () => {
    // The second save must carry the choice too: a form reset that blanks a
    // hidden field turns the next submit into a refusal nobody asked for.
    const seen: FormData[] = [];
    const action: SettingsAction = async (_state, formData) => {
      seen.push(formData);
      return SETTINGS_SAVED;
    };
    const user = userEvent.setup();
    renderForm(action);

    fireEvent.change(screen.getByLabelText(/pass mark for moving up/i), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(seen).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(seen).toHaveLength(2));

    expect(seen[0]?.get("masteryThreshold")).toBe("50");
    expect(seen[1]?.get("masteryThreshold")).toBe("50");
  });

  it("shows the freshly saved profile when the refresh delivers it", async () => {
    // What the save-then-refresh cycle looks like from here: the same form,
    // re-rendered with the stored profile. It must adopt it rather than keep
    // rendering the one it was mounted with.
    const action: SettingsAction = async () => SETTINGS_SAVED;
    const { rerender } = renderForm(action);

    expect(screen.getByRole("radio", { name: /clearly/i })).toBeChecked();

    rerender(
      <SettingsForm
        profile={{ ...PROFILE, correctionPreference: "minimal", masteryThreshold: 33 }}
        action={action}
        initialState={INITIAL_SETTINGS_STATE}
      />,
    );

    expect(screen.getByRole("radio", { name: /rarely/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /clearly/i })).not.toBeChecked();
    expect(screen.getByText(/relaxed 33%/i)).toBeInTheDocument();
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
