import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { ScenarioExplorer } from "@/components/scenarios/scenario-explorer";
import type { ScenarioSummary } from "@dp/domain/scenario";
import { server } from "@dp/test-support/msw";

/**
 * The scenario search surface.
 *
 * The three things worth proving: the type filter shows only that type, the
 * card's single action is decided by the type, and a search replaces the
 * browsed grid with what the endpoint returned — or a plain sentence when
 * the endpoint refuses.
 */

const DIALOGUE: ScenarioSummary = {
  id: 1,
  slug: "dialogue-a1-im-restaurant",
  type: "dialogue",
  kind: "dialogue",
  title: "Im Restaurant",
  titleEnglish: "At the Restaurant",
  description: "A customer orders lunch.",
  targetLevel: "A1",
  source: "Conversational_German_15_Dialogue_Stories.md",
  itemIndex: 0,
};

const COMPREHENSION: ScenarioSummary = {
  id: 2,
  slug: "comprehension-a1-reading-ein-neuer-morgen",
  type: "comprehension",
  kind: "reading",
  title: "Ein neuer Morgen",
  titleEnglish: "A New Morning",
  description: "A short passage about a morning routine.",
  targetLevel: "A1",
  source: "German_Listening_and_Comprehension_Practice.md",
  itemIndex: 20,
};

function renderExplorer() {
  return render(
    <ScenarioExplorer
      initial={[DIALOGUE, COMPREHENSION]}
      practiceAction={vi.fn()}
    />,
  );
}

describe("browsing", () => {
  it("shows every scenario before any search", () => {
    renderExplorer();

    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    expect(screen.getByText("Ein neuer Morgen")).toBeInTheDocument();
  });

  it("shows only dialogues on the Dialogues tab", async () => {
    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "Dialogues" }));

    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    expect(screen.queryByText("Ein neuer Morgen")).not.toBeInTheDocument();
  });

  it("shows only comprehensions on the Comprehensions tab", async () => {
    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "Comprehensions" }));

    expect(screen.queryByText("Im Restaurant")).not.toBeInTheDocument();
    expect(screen.getByText("Ein neuer Morgen")).toBeInTheDocument();
  });
});

describe("the card actions", () => {
  it("offers a dialogue the chat as its lead action, the script beside it", () => {
    renderExplorer();

    expect(
      screen.getByRole("button", { name: "Practice Dialogue (AI Chat)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the script" })).toHaveAttribute(
      "href",
      "/scenarios/dialogue-a1-im-restaurant",
    );
  });

  it("offers a comprehension the chat too, where wrong answers are explained", () => {
    // The self-check quiz stays one click away; the practice that counts —
    // explanations, and mistakes written to the record — is the chat.
    renderExplorer();

    expect(
      screen.getByRole("button", { name: "Practice Reading (AI Chat)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read & self-check" })).toHaveAttribute(
      "href",
      "/scenarios/comprehension-a1-reading-ein-neuer-morgen",
    );
  });

  it("cites each card's source document", () => {
    renderExplorer();

    expect(
      screen.getByText(
        "Source: Conversational German: 15 Dialogue Stories, item 1",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Source: German Listening & Comprehension Practice, item 21",
      ),
    ).toBeInTheDocument();
  });
});

describe("searching", () => {
  it("sends the query with the active type filter and shows what returns", async () => {
    let requestBody: unknown;
    server.use(
      http.post("/api/scenarios/search", async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ results: [DIALOGUE] });
      }),
    );

    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "Dialogues" }));
    await user.type(
      screen.getByLabelText("Search scenarios"),
      "ordering food at a restaurant",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    });
    expect(screen.queryByText("Ein neuer Morgen")).not.toBeInTheDocument();
    expect(requestBody).toEqual({
      query: "ordering food at a restaurant",
      type: "dialogue",
    });
  });

  it("says plainly when nothing matched", async () => {
    server.use(
      http.post("/api/scenarios/search", () => HttpResponse.json({ results: [] })),
    );

    const user = userEvent.setup();
    renderExplorer();

    await user.type(screen.getByLabelText("Search scenarios"), "quantum physics");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText(/nothing matched/i)).toBeInTheDocument();
    });
  });

  it("returns to browsing when the search is cleared", async () => {
    server.use(
      http.post("/api/scenarios/search", () => HttpResponse.json({ results: [] })),
    );

    const user = userEvent.setup();
    renderExplorer();

    await user.type(screen.getByLabelText("Search scenarios"), "x");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(
      await screen.findByRole("button", { name: "Show all scenarios" }),
    );

    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    expect(screen.getByText("Ein neuer Morgen")).toBeInTheDocument();
  });

  it("shows the server's own sentence when the search is refused", async () => {
    server.use(
      http.post("/api/scenarios/search", () =>
        HttpResponse.json(
          {
            error: "search_unavailable",
            message: "Scenario search is unavailable right now. Please try again shortly.",
          },
          { status: 503 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderExplorer();

    await user.type(screen.getByLabelText("Search scenarios"), "ordering food");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /search is unavailable/i,
    );
    // The browsed grid is still there; a failed search removes nothing.
    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
  });
});

describe("the layout toggle", () => {
  it("starts on the grid, where a card carries its description", () => {
    renderExplorer();

    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("A customer orders lunch.")).toBeInTheDocument();
  });

  it("drops the descriptions in the list, which is what makes it dense", async () => {
    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "List view" }));

    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      expect(
        screen.queryByText("A customer orders lunch."),
      ).not.toBeInTheDocument();
    });
    // The scenarios themselves are all still there; only the prose went.
    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    expect(screen.getByText("Ein neuer Morgen")).toBeInTheDocument();
  });

  it("keeps both actions named when they collapse to icons", async () => {
    // An icon-only button has no accessible name of its own. If these labels
    // ever drift from the grid's button text, the list view becomes the one
    // place on the page a screen reader cannot follow.
    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "List view" }));

    expect(
      screen.getByRole("button", { name: "Practice Dialogue (AI Chat)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Practice Reading (AI Chat)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the script" })).toHaveAttribute(
      "href",
      "/scenarios/dialogue-a1-im-restaurant",
    );
    expect(
      screen.getByRole("link", { name: "Read & self-check" }),
    ).toHaveAttribute(
      "href",
      "/scenarios/comprehension-a1-reading-ein-neuer-morgen",
    );
  });

  it("survives a filter change and keeps the chosen layout", async () => {
    const user = userEvent.setup();
    renderExplorer();

    await user.click(screen.getByRole("button", { name: "List view" }));
    await user.click(screen.getByRole("button", { name: "Dialogues" }));

    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Im Restaurant")).toBeInTheDocument();
    expect(screen.queryByText("Ein neuer Morgen")).not.toBeInTheDocument();
  });
});
