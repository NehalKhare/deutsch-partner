import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { TrainerSession } from "@/components/trainer/session";
import { server } from "../../msw/server";

/**
 * The Trainer's surface.
 *
 * What matters: the wait is honest (a working indicator while the agent
 * runs), the answer arrives with its receipts (tool steps and sources), the
 * transcript travels capped, and a refusal is a plain sentence with the
 * learner's words put back.
 */

const TRAINER_ENDPOINT = "http://localhost:3000/api/trainer";

const REPLY = {
  reply: 'Richtig! "fahren" sitzt. Nächstes Wort?',
  steps: [
    { tool: "get_review_session", summary: '{"dueCount":3}' },
    { tool: "record_review_outcome", summary: '{"recorded":true}' },
  ],
  sources: [{ documentId: 7, contentType: "grammar", score: 0.8 }],
  costEur: 0.004,
};

async function sendMessage(text = "Lass uns üben!") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your message to the trainer/i), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
  return user;
}

describe("a working trainer", () => {
  it("shows the learner's words at once and works visibly until the reply lands", async () => {
    let resolve: (response: Response) => void = () => undefined;
    server.use(
      http.post(
        TRAINER_ENDPOINT,
        () => new Promise<Response>((r) => (resolve = r)),
      ),
    );
    render(<TrainerSession />);

    await sendMessage();

    expect(screen.getByText("Lass uns üben!")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/trainer is working/i);

    resolve(HttpResponse.json(REPLY));

    await waitFor(() => {
      expect(screen.getByText(/richtig!/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows the tools the trainer used, in plain words", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(container.querySelector("[data-role='steps']")).toBeInTheDocument();
    });
    expect(screen.getByText(/looked up what is due for review/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded how that went/i)).toBeInTheDocument();
  });

  it("cites the sources the search read", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(container.querySelector("[data-role='sources']")).toHaveTextContent(
        "grammar #7",
      );
    });
  });

  it("labels a tool it has no name for without hiding it", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          steps: [{ tool: "ask_question", summary: "" }],
        }),
      ),
    );
    render(<TrainerSession />);

    await sendMessage();

    expect(
      await screen.findByText(/asked a connected tool \(ask_question\)/i),
    ).toBeInTheDocument();
  });
});

describe("what travels with a turn", () => {
  it("carries the capped transcript, roles and content only", async () => {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(TRAINER_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(REPLY);
      }),
    );
    render(<TrainerSession />);

    const user = await sendMessage("Erste Nachricht hier");
    await waitFor(() => expect(captured).toHaveLength(1));

    await user.type(
      screen.getByLabelText(/your message to the trainer/i),
      "Zweite Nachricht",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(captured).toHaveLength(2));

    expect(captured[0]?.history).toEqual([]);
    const history = captured[1]?.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    for (const line of history) {
      expect(Object.keys(line).sort()).toEqual(["content", "role"]);
    }
  });
});

describe("a turn the server refused", () => {
  it("says the server's own sentence and puts the words back in the box", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json(
          { error: "budget_denied", message: "Today's practice budget is used up." },
          { status: 429 },
        ),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage("Ich möchte üben.");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/practice budget/i);
    });
    expect(container.querySelectorAll("[data-role='user']")).toHaveLength(0);
    expect(screen.getByLabelText(/your message to the trainer/i)).toHaveValue(
      "Ich möchte üben.",
    );
  });
});
