import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CompanionDemo } from "@/components/landing/companion-demo";
import { TUTOR } from "@dp/domain/tutor";

describe("CompanionDemo", () => {
  it("starts on the learner's turn, so the visitor is the one invited to speak", async () => {
    render(<CompanionDemo />);

    expect(await screen.findByRole("img")).toHaveAttribute(
      "data-emotion",
      "listening",
    );
    expect(screen.getByRole("radio", { name: /you speak/i })).toBeChecked();
  });

  it("comes alive when the companion takes its turn", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    await user.click(
      screen.getByRole("radio", { name: new RegExp(`${TUTOR.name} speaks`, "i") }),
    );

    expect(screen.getByRole("img")).toHaveAttribute("data-emotion", "smiling");
    expect(screen.getByRole("img")).toHaveAttribute("data-animated", "true");
  });

  it("offers the three turns of a real conversation", () => {
    render(<CompanionDemo />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("makes the companion listen when it is the learner's turn", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    await user.click(
      screen.getByRole("radio", { name: new RegExp(`${TUTOR.name} speaks`, "i") }),
    );
    await user.click(screen.getByRole("radio", { name: /you speak/i }));

    expect(screen.getByRole("img")).toHaveAttribute("data-emotion", "listening");
  });

  it("stops animating when the companion is not the one talking", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    await user.click(
      screen.getByRole("radio", { name: new RegExp(`${TUTOR.name} speaks`, "i") }),
    );
    await user.click(screen.getByRole("radio", { name: /you speak/i }));

    expect(screen.getByRole("img")).toHaveAttribute("data-animated", "false");
  });

  it("shows the sad face when the learner slips up", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    await user.click(screen.getByRole("radio", { name: /you slip up/i }));

    expect(screen.getByRole("img")).toHaveAttribute("data-emotion", "sad");
  });

  it("marks the current turn as selected for assistive technology", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    const tutorTurn = screen.getByRole("radio", {
      name: new RegExp(`${TUTOR.name} speaks`, "i"),
    });
    await user.click(tutorTurn);

    expect(tutorTurn).toBeChecked();
    expect(screen.getByRole("radio", { name: /you speak/i })).not.toBeChecked();
  });

  it("changes what the companion says with the turn", async () => {
    const user = userEvent.setup();
    render(<CompanionDemo />);

    const spoken = screen.getByTestId("companion-line").textContent;
    await user.click(screen.getByRole("radio", { name: /you slip up/i }));

    expect(screen.getByTestId("companion-line").textContent).not.toBe(spoken);
  });

  it("gives every German line an English scaffold", () => {
    render(<CompanionDemo />);

    expect(screen.getByTestId("companion-line")).toBeInTheDocument();
    expect(screen.getByTestId("companion-gloss")).toBeInTheDocument();
  });
});
