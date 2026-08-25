import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VocabularyTiles } from "@/components/dashboard/vocabulary-tiles";
import type { PractisedWord, VocabularyWords } from "@/lib/dashboard/vocabulary";

/**
 * The four figures, and what happens when one is pressed.
 *
 * A number a learner cannot open is a number they cannot use. What is being
 * checked here is that pressing one shows the words behind it, that the count
 * and the list cannot silently disagree, and that a screen reader is told the
 * tile is a disclosure rather than being left to guess.
 */

const word = (
  over: Partial<PractisedWord> & Pick<PractisedWord, "id" | "word">,
): PractisedWord => ({
  article: "der",
  english: "station",
  masteryScore: 0.4,
  ...over,
});

const WORDS: VocabularyWords = {
  known: [
    word({ id: "1", word: "Bahnhof" }),
    word({ id: "2", word: "Haus", article: "das", english: "house" }),
  ],
  mastered: [word({ id: "2", word: "Haus", article: "das", english: "house" })],
  due: [word({ id: "1", word: "Bahnhof" })],
  tricky: [],
};

const COUNTS = { known: 2, mastered: 1, due: 1, tricky: 0 };

const renderTiles = (counts = COUNTS, words = WORDS) =>
  render(<VocabularyTiles counts={counts} words={words} />);

describe("the tiles", () => {
  it("shows every figure without anything being opened", () => {
    renderTiles();

    expect(screen.getByRole("button", { name: /known/i })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /mastered/i })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /tricky/i })).toHaveTextContent("0");
  });

  it("says it is a disclosure, and that it is closed", () => {
    renderTiles();

    expect(screen.getByRole("button", { name: /known/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows no words until one is pressed", () => {
    renderTiles();

    expect(screen.queryByText("Bahnhof")).not.toBeInTheDocument();
  });
});

describe("opening one", () => {
  it("shows the words behind the figure", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    expect(screen.getByText("Bahnhof")).toBeInTheDocument();
    expect(screen.getByText("Haus")).toBeInTheDocument();
  });

  it("shows each word with its article and its English", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    const row = screen.getByText("Bahnhof").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("der")).toBeInTheDocument();
    expect(within(row!).getByText("station")).toBeInTheDocument();
  });

  it("marks the German as German, so it is not read out in English", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    expect(screen.getByText("Bahnhof").closest("[lang]")).toHaveAttribute("lang", "de");
  });

  it("shows only that figure's words", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /mastered/i }));

    expect(screen.getByText("Haus")).toBeInTheDocument();
    expect(screen.queryByText("Bahnhof")).not.toBeInTheDocument();
  });

  it("swaps to another figure's words rather than showing both", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /known/i }));
    await userEvent.click(screen.getByRole("button", { name: /due/i }));

    expect(screen.getByRole("button", { name: /due/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /known/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Haus")).not.toBeInTheDocument();
  });

  it("closes again when the same figure is pressed twice", async () => {
    renderTiles();

    const known = screen.getByRole("button", { name: /known/i });
    await userEvent.click(known);
    await userEvent.click(known);

    expect(known).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Bahnhof")).not.toBeInTheDocument();
  });

  it("points at the panel it opens", async () => {
    renderTiles();

    const known = screen.getByRole("button", { name: /known/i });
    await userEvent.click(known);

    const panel = document.getElementById(known.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText("Bahnhof")).toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  it("says why a figure is empty rather than showing a blank panel", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /tricky/i }));

    expect(screen.getByText(/going wrong a few times/i)).toBeInTheDocument();
  });

  it("opens on a learner who has said nothing at all", async () => {
    renderTiles(
      { known: 0, mastered: 0, due: 0, tricky: 0 },
      { known: [], mastered: [], due: [], tricky: [] },
    );

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    expect(screen.getByText(/have a conversation/i)).toBeInTheDocument();
  });
});

describe("when the list cannot show everything the figure counted", () => {
  it("says how many of them it is showing", async () => {
    // The figure is counted over every row in the database; the list carries
    // what the page loaded. Quietly showing fewer would make the number look
    // wrong instead.
    renderTiles({ ...COUNTS, known: 240 });

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    expect(screen.getByText(/showing 2 of 240/i)).toBeInTheDocument();
  });

  it("says nothing when the list is complete", async () => {
    renderTiles();

    await userEvent.click(screen.getByRole("button", { name: /known/i }));

    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });
});
