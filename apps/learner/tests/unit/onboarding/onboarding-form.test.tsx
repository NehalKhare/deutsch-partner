import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import {
  INTEREST_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  TOPIC_OPTIONS,
} from "@dp/domain/onboarding/defaults";
import type { OnboardingFormState } from "@/lib/onboarding/form-state";

const idle: OnboardingFormState = { message: null, status: "idle" };

type FormAction = (
  state: OnboardingFormState,
  formData: FormData,
) => Promise<OnboardingFormState>;

const noop: FormAction = async () => idle;

function renderForm(action: FormAction = noop) {
  return render(<OnboardingForm action={action} initialState={idle} />);
}

describe("level selection", () => {
  it("offers the three levels the product teaches", () => {
    renderForm();

    expect(screen.getAllByRole("radio", { name: /starting from scratch|know some basics|hold a simple conversation/i }))
      .toHaveLength(3);
  });

  it("preselects the beginner level", () => {
    renderForm();

    expect(
      screen.getByRole("radio", { name: /starting from scratch/i }),
    ).toBeChecked();
  });

  it("tells the learner their choice is a preference, not a placement", () => {
    renderForm();

    expect(
      screen.getByText(/everyone begins at the first mini-level/i),
    ).toBeInTheDocument();
  });
});

describe("fields", () => {
  it("asks for a learning goal", () => {
    renderForm();

    expect(
      screen.getByLabelText(/what do you want to be able to do/i),
    ).toBeRequired();
  });

  it("offers every topic on the closed list", () => {
    renderForm();

    const group = screen.getByRole("group", { name: /what should we talk about/i });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(
      TOPIC_OPTIONS.length,
    );
  });

  it("offers every interest on the closed list", () => {
    renderForm();

    const group = screen.getByRole("group", { name: /what are you into/i });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(
      INTEREST_OPTIONS.length,
    );
  });

  it("states the topic limit rather than only enforcing it server-side", () => {
    renderForm();

    expect(
      screen.getByRole("group", { name: /what should we talk about/i }),
    ).toHaveAccessibleDescription(
      new RegExp(`choose up to ${MAX_SELECTED_TOPICS}`, "i"),
    );
  });

  it("preselects gentle correction", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /gently/i })).toBeChecked();
  });

  it("nothing is selected in the topic list by default", () => {
    renderForm();

    const group = screen.getByRole("group", { name: /what should we talk about/i });
    for (const box of within(group).getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }
  });
});

describe("submission", () => {
  it("sends the learner's selections", async () => {
    const action = vi.fn(
      async (_state: OnboardingFormState, _data: FormData) => idle,
    );
    const user = userEvent.setup();
    renderForm(action);

    await user.type(
      screen.getByLabelText(/what do you want to be able to do/i),
      "Chat with my neighbours",
    );
    await user.click(screen.getByRole("radio", { name: /know some basics/i }));
    await user.click(screen.getByRole("checkbox", { name: /travel and getting around/i }));
    await user.click(screen.getByRole("checkbox", { name: /cycling/i }));
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    const data = action.mock.calls[0]?.[1];
    expect(data?.get("learningGoal")).toBe("Chat with my neighbours");
    expect(data?.get("selectedLevel")).toBe("A2");
    expect(data?.getAll("targetTopics")).toEqual(["travel"]);
    expect(data?.getAll("interests")).toEqual(["cycling"]);
  });

  it("submits a text-mode preference until voice exists", async () => {
    const action = vi.fn(
      async (_state: OnboardingFormState, _data: FormData) => idle,
    );
    const user = userEvent.setup();
    renderForm(action);

    await user.type(
      screen.getByLabelText(/what do you want to be able to do/i),
      "Goal",
    );
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    const data = action.mock.calls[0]?.[1];
    expect(data?.get("inputPreference")).toBe("text");
    expect(data?.get("outputPreference")).toBe("text");
  });

  it("announces a failure in a live region", () => {
    render(
      <OnboardingForm
        action={noop}
        initialState={{ status: "error", message: "Please check your topics." }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Please check your topics.",
    );
  });
});

describe("the choosing limit", () => {
  const topics = () =>
    screen.getByRole("group", { name: /what should we talk about/i });
  const interests = () =>
    screen.getByRole("group", { name: /what are you into/i });

  /** Ticks boxes until `count` of them are on. Idempotent, so it can top up. */
  async function pick(
    user: ReturnType<typeof userEvent.setup>,
    group: HTMLElement,
    count: number,
  ) {
    const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
    for (const box of boxes) {
      if (boxes.filter((entry) => entry.checked).length >= count) break;
      if (!box.checked) await user.click(box);
    }
    return boxes;
  }

  it("stops offering more once the limit is reached", async () => {
    // The limit used to be enforced only on the server, so a learner could
    // tick eight of them, press the button and be told to check their topics.
    const user = userEvent.setup();
    renderForm();

    const boxes = await pick(user, topics(), MAX_SELECTED_TOPICS);

    for (const box of boxes.slice(0, MAX_SELECTED_TOPICS)) {
      expect(box).toBeEnabled();
    }
    for (const box of boxes.slice(MAX_SELECTED_TOPICS)) {
      expect(box).toBeDisabled();
    }
  });

  it("lets a learner swap one choice for another", async () => {
    const user = userEvent.setup();
    renderForm();

    const boxes = await pick(user, topics(), MAX_SELECTED_TOPICS);
    await user.click(boxes[0] as HTMLElement);

    expect(boxes[MAX_SELECTED_TOPICS]).toBeEnabled();
  });

  it("says how many have been chosen, and how to change that", async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, topics(), 2);
    expect(topics()).toHaveAccessibleDescription(/2 chosen/i);

    await pick(user, topics(), MAX_SELECTED_TOPICS);
    expect(topics()).toHaveAccessibleDescription(/untick one/i);
  });

  it("does not nag before anything is chosen", () => {
    renderForm();

    expect(topics()).not.toHaveAccessibleDescription(/chosen/i);
  });

  it("counts the two lists separately", async () => {
    const user = userEvent.setup();
    renderForm();

    await pick(user, topics(), MAX_SELECTED_TOPICS);

    for (const box of within(interests()).getAllByRole("checkbox")) {
      expect(box).toBeEnabled();
    }
  });

  it("submits only what was chosen, and never more than the limit", async () => {
    const action = vi.fn(
      async (_state: OnboardingFormState, _data: FormData) => idle,
    );
    const user = userEvent.setup();
    renderForm(action);

    await user.type(
      screen.getByLabelText(/what do you want to be able to do/i),
      "Order coffee in Vienna",
    );
    await pick(user, topics(), MAX_SELECTED_TOPICS);
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action.mock.calls[0]?.[1].getAll("targetTopics")).toHaveLength(
      MAX_SELECTED_TOPICS,
    );
  });

  it("files an interest as an interest and not as a topic", async () => {
    // The two groups look identical and are one argument apart in the source.
    const action = vi.fn(
      async (_state: OnboardingFormState, _data: FormData) => idle,
    );
    const user = userEvent.setup();
    renderForm(action);

    await user.type(
      screen.getByLabelText(/what do you want to be able to do/i),
      "Order coffee in Vienna",
    );
    await user.click(screen.getByRole("checkbox", { name: /cycling/i }));
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.getAll("interests")).toEqual(["cycling"]);
    expect(submitted?.getAll("targetTopics")).toEqual([]);
  });

  it("stops offering more interests once that list is full", async () => {
    const user = userEvent.setup();
    renderForm();

    const boxes = await pick(user, interests(), MAX_SELECTED_INTERESTS);

    expect(boxes[MAX_SELECTED_INTERESTS]).toBeDisabled();
    expect(interests()).toHaveAccessibleDescription(/untick one/i);
  });
});

describe("when the server refuses", () => {
  /** An action that always refuses, the way the topic cap does. */
  const refuse: FormAction = async () => ({
    status: "error",
    message: "Please check your topics and try again.",
  });

  it("keeps what the learner already typed", async () => {
    // React resets an uncontrolled form once its action completes. A learner
    // who has to retype everything after each refusal will hit the same
    // refusal again, which is what "it always fails" looks like from outside.
    const user = userEvent.setup();
    renderForm(refuse);

    const goal = screen.getByLabelText(/what do you want to be able to do/i);
    await user.type(goal, "Order coffee in Vienna");
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(goal).toHaveValue("Order coffee in Vienna");
  });

  /** The goal is required, so nothing submits at all without it. */
  async function fillGoal(user: ReturnType<typeof userEvent.setup>) {
    await user.type(
      screen.getByLabelText(/what do you want to be able to do/i),
      "Order coffee in Vienna",
    );
  }

  it("keeps the level they chose", async () => {
    const user = userEvent.setup();
    renderForm(refuse);

    await fillGoal(user);
    await user.click(screen.getByRole("radio", { name: /know some basics/i }));
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(screen.getByRole("radio", { name: /know some basics/i })).toBeChecked();
  });

  it("never leaves the level with nothing chosen at all", async () => {
    // Worse than losing the answer: the form comes back in a state the learner
    // could not have put it in, with no level selected and no default.
    const user = userEvent.setup();
    renderForm(refuse);

    await fillGoal(user);
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(
      screen.getAllByRole("radio", { name: /scratch|basics|simple conversation/i })
        .filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);
  });

  it("keeps the correction preference they chose", async () => {
    const user = userEvent.setup();
    renderForm(refuse);

    await fillGoal(user);
    await user.click(screen.getByRole("radio", { name: /clearly, with a short/i }));
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(
      screen.getByRole("radio", { name: /clearly, with a short/i }),
    ).toBeChecked();
  });

  it("keeps the topics they picked", async () => {
    const user = userEvent.setup();
    renderForm(refuse);

    await fillGoal(user);
    await user.click(screen.getByRole("checkbox", { name: /travel and getting around/i }));
    await user.click(screen.getByRole("button", { name: /start learning/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/check your topics/i);
    });
    expect(
      screen.getByRole("checkbox", { name: /travel and getting around/i }),
    ).toBeChecked();
  });
});
