import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComprehensionQuiz } from "@/components/scenarios/comprehension-quiz";

/**
 * The quiz: questions in, answers checked, nothing ever called "wrong" —
 * a non-match shows the model answer to compare against instead.
 */

const QUESTIONS = [
  { question: "Wann steht Anna auf?", answer: "Um sieben Uhr." },
  { question: "Was trinkt sie?", answer: "Kaffee." },
];

describe("the comprehension quiz", () => {
  it("asks every question with its own input", () => {
    render(<ComprehensionQuiz questions={QUESTIONS} />);

    expect(screen.getByLabelText(/wann steht anna auf/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/was trinkt sie/i)).toBeInTheDocument();
  });

  it("marks a matching answer correct and shows the model answer otherwise", async () => {
    const user = userEvent.setup();
    render(<ComprehensionQuiz questions={QUESTIONS} />);

    await user.type(screen.getByLabelText(/wann steht anna auf/i), "um sieben uhr");
    await user.type(screen.getByLabelText(/was trinkt sie/i), "Tee");
    await user.click(screen.getByRole("button", { name: "Check answers" }));

    expect(screen.getByText(/✓ correct/i)).toBeInTheDocument();
    expect(screen.getByText(/compare with the answer/i)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 matched the answer.")).toBeInTheDocument();
  });

  it("starts over cleanly", async () => {
    const user = userEvent.setup();
    render(<ComprehensionQuiz questions={QUESTIONS} />);

    await user.type(screen.getByLabelText(/wann steht anna auf/i), "x");
    await user.click(screen.getByRole("button", { name: "Check answers" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByLabelText(/wann steht anna auf/i)).toHaveValue("");
    expect(screen.queryByText(/matched the answer/i)).not.toBeInTheDocument();
  });
});
