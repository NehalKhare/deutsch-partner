import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { TrainerSession } from "@/components/trainer/session";
import { server } from "@dp/test-support/msw";

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
    { tool: "get_review_session", summary: "3 items to go" },
    { tool: "record_review_outcome", summary: "\u201cfahren\u201d — correct" },
  ],
  sources: [{ documentId: 7, contentType: "grammar", score: 0.8 }],
  agenda: [
    { kind: "recall", subject: "fahren" },
    { kind: "correct_the_mistake", subject: "case_dative" },
  ],
  covered: ["der Bahnhof"],
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

describe("how a reply is formatted", () => {
  it("shows an emphasised word as emphasis, not as asterisks", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          reply: 'Ja, super: **das Buch**. Noch eins: ___ Tasche?',
        }),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage();

    const strong = await waitFor(() => {
      const found = container.querySelector("strong");
      if (!found) throw new Error("nothing emphasised yet");
      return found;
    });
    expect(strong).toHaveTextContent("das Buch");
    expect(container.textContent).not.toContain("**");
  });

  it("shows an agenda as a list rather than one run-on line", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          reply: "Heute üben wir:\n1. spelling\n2. article\n3. word_order",
        }),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage();

    // Scoped to the reply: the agenda panel has a list of its own.
    const reply = "[data-role='assistant'] ol";
    await waitFor(() => {
      expect(container.querySelector(reply)).toBeInTheDocument();
    });
    expect(container.querySelectorAll(`${reply} > li`)).toHaveLength(3);
  });

  it("cannot be talked into markup by a reply that contains some", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          reply: "Sag mal: <img src=x onerror=alert(1)> und **jetzt**",
        }),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => expect(container.querySelector("strong")).toBeInTheDocument());
    // The angle brackets are text, because nothing here ever builds HTML.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("the session's agenda", () => {
  it("shows what the session will cover, and what is already done", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    const agenda = await waitFor(() => {
      const found = container.querySelector("[data-role='agenda']");
      if (!found) throw new Error("no agenda yet");
      return found;
    });
    expect(agenda).toHaveTextContent("der Bahnhof");
    expect(agenda).toHaveTextContent("fahren");
    expect(agenda).toHaveTextContent(/fix the mistake/i);
    expect(agenda.querySelectorAll("[data-done='true']")).toHaveLength(1);
  });

  it("keeps the plan beside the transcript, not inside it", async () => {
    // It used to sit at the top of the conversation, where it pushed the
    // replies down and scrolled away with them. A plan you cannot see while
    // you work through it is a plan you have to remember instead.
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    const agenda = await waitFor(() => {
      const found = container.querySelector("[data-role='agenda']");
      if (!found) throw new Error("no agenda yet");
      return found;
    });

    expect(agenda.closest("aside")).not.toBeNull();
    // And the transcript is not inside that column either way round.
    const transcript = container.querySelector("ol[aria-live]");
    expect(transcript).not.toBeNull();
    expect(agenda.contains(transcript)).toBe(false);
    expect(transcript?.contains(agenda)).toBe(false);
  });

  it("drops the column on a small screen rather than stacking it", async () => {
    // The stacked arrangement is the one this replaced. The trainer opens
    // every session by saying what it will cover, so a phone still gets the
    // plan — in the transcript, where there is room for it.
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    const column = await waitFor(() => {
      const found = container.querySelector("[data-role='agenda']")?.closest("aside");
      if (!found) throw new Error("no agenda yet");
      return found;
    });

    expect(column.className).toContain("hidden");
    expect(column.className).toContain("lg:block");
  });

  it("shows nothing before the trainer has planned anything", () => {
    const { container } = render(<TrainerSession />);

    expect(container.querySelector("[data-role='agenda']")).toBeNull();
  });

  it("sends the covered subjects back, so nothing is asked twice", async () => {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(TRAINER_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...REPLY, covered: ["der Bahnhof", "fahren"] });
      }),
    );
    render(<TrainerSession />);

    const user = await sendMessage();
    await waitFor(() => expect(captured).toHaveLength(1));

    await user.type(screen.getByLabelText(/your message to the trainer/i), "fahren");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(captured).toHaveLength(2));

    expect(captured[0]?.covered).toEqual([]);
    expect(captured[1]?.covered).toEqual(["der Bahnhof", "fahren"]);
  });

  it("sends the planned agenda back, so the plan is a promise the server keeps", async () => {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(TRAINER_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(REPLY);
      }),
    );
    render(<TrainerSession />);

    const user = await sendMessage();
    await waitFor(() => expect(captured).toHaveLength(1));

    await user.type(screen.getByLabelText(/your message to the trainer/i), "fahren");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(captured).toHaveLength(2));

    // Nothing to pin before the trainer has planned; afterwards the plan
    // travels up whole, keys only, exactly as the server announced it.
    expect(captured[0]?.agenda).toBeUndefined();
    expect(captured[1]?.agenda).toEqual([
      { kind: "recall", subject: "fahren" },
      { kind: "correct_the_mistake", subject: "case_dative" },
    ]);
  });

  it("keeps the agenda through a turn that did not touch it", async () => {
    let turn = 0;
    server.use(
      http.post(TRAINER_ENDPOINT, () => {
        turn += 1;
        return HttpResponse.json(
          turn === 1 ? REPLY : { ...REPLY, agenda: null, covered: ["der Bahnhof"] },
        );
      }),
    );
    const { container } = render(<TrainerSession />);

    const user = await sendMessage();
    await waitFor(() =>
      expect(container.querySelector("[data-role='agenda']")).toBeInTheDocument(),
    );

    await user.type(
      screen.getByLabelText(/your message to the trainer/i),
      "Was ist der Dativ?",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(turn).toBe(2));
    expect(container.querySelector("[data-role='agenda']")).toHaveTextContent("fahren");
  });
});

describe("a session that has run out of things to review", () => {
  const FINAL = {
    ...REPLY,
    reply: "Das war alles. Behalte: fahren — to drive.",
    agenda: [],
    covered: ["der Bahnhof", "fahren"],
    complete: true,
  };

  it("closes the chat and offers a fresh session instead", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(FINAL)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(container.querySelector("[data-role='session-end']")).toBeInTheDocument();
    });
    // No box to type in: the trainer has been told not to answer another
    // question, so the page must not invite one.
    expect(screen.queryByLabelText(/your message to the trainer/i)).toBeNull();
    expect(screen.getByText(/das war alles/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start a new session/i }),
    ).toBeInTheDocument();
  });

  it("starts the next session from scratch", async () => {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(TRAINER_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(FINAL);
      }),
    );
    render(<TrainerSession />);

    const user = await sendMessage();
    await waitFor(() => expect(captured).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /start a new session/i }));

    // A clean sheet: the finished session's subjects are not carried into the
    // new one, so the agenda is planned again from whatever is still due.
    expect(screen.queryByText(/das war alles/i)).toBeNull();
    await user.type(
      screen.getByLabelText(/your message to the trainer/i),
      "Nochmal!",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(captured).toHaveLength(2));

    expect(captured[1]).toMatchObject({ covered: [], history: [] });
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

describe("a request the plan refused", () => {
  // billing-and-plans-spec.md S4: a quota refuses this request and nothing
  // else. The agenda, what it has covered and the transcript are the
  // browser's, and stay; the sentence goes back in the box; the prompt says
  // when the window reopens and that progress is saved.
  const refusal = (over: Record<string, unknown> = {}) => ({
    error: "quota_exhausted",
    message: "You've used today's Trainer requests.",
    resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    upgrade: true,
    ...over,
  });

  async function refuseSecondTurn(body: Record<string, unknown>) {
    let turn = 0;
    server.use(
      http.post(TRAINER_ENDPOINT, () => {
        turn += 1;
        return turn === 1 ? HttpResponse.json(REPLY) : HttpResponse.json(body, { status: 429 });
      }),
    );
    const rendered = render(<TrainerSession />);

    await sendMessage();
    await screen.findByText(/richtig!/i);
    const user = await sendMessage("Fahren heißt to drive.");
    await screen.findByText(String(body.message));

    return { user, ...rendered };
  }

  it("shows an upgrade prompt in place of the red alert", async () => {
    await refuseSecondTurn(refusal());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/your progress is saved/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
  });

  it("says it in a live region that was on the page before it, so a screen reader hears it", async () => {
    let region: Element | null = null;
    let turn = 0;
    server.use(
      http.post(TRAINER_ENDPOINT, () => {
        turn += 1;
        return turn === 1 ? HttpResponse.json(REPLY) : HttpResponse.json(refusal(), { status: 429 });
      }),
    );
    const { container } = render(<TrainerSession />);
    region = container.querySelector("[data-live='plan']");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    await sendMessage();
    await screen.findByText(/richtig!/i);
    await sendMessage("Fahren heißt to drive.");

    await waitFor(() => expect(region).toHaveTextContent("You've used today's Trainer requests."));
    expect(container.querySelector("[data-live='plan']")).toBe(region);
  });

  it("keeps the session: the transcript, the agenda and the draft", async () => {
    const { container } = await refuseSecondTurn(refusal());

    expect(screen.getByText(/richtig!/i)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-role='user']")).toHaveLength(1);
    expect(screen.getAllByText("fahren").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/your message to the trainer/i)).toHaveValue("Fahren heißt to drive.");
    // Still a session in progress, not one that ended.
    expect(container.querySelector("[data-role='session-end']")).not.toBeInTheDocument();
  });

  it("resumes the same agenda once a request goes through", async () => {
    const sent: unknown[] = [];
    const { user } = await refuseSecondTurn(refusal());
    server.use(
      http.post(TRAINER_ENDPOINT, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(REPLY);
      }),
    );

    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      agenda: REPLY.agenda,
      covered: REPLY.covered,
      message: "Fahren heißt to drive.",
    });
    await waitFor(() =>
      expect(screen.queryByText("You've used today's Trainer requests.")).not.toBeInTheDocument(),
    );
  });

  it("sells a Premium learner nothing", async () => {
    await refuseSecondTurn(refusal({ upgrade: false }));

    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
  });

  it("says a spent allowance the same way", async () => {
    await refuseSecondTurn(
      refusal({
        error: "budget_exhausted",
        message: "You've used your AI allowance for now.",
        resetAt: "2026-11-01T00:00:00.000Z",
      }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/renews on/i)).toBeInTheDocument();
  });
});

describe("what the learner's feedback has changed", () => {
  it("offers a vote under every reply and none under the learner's own lines", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(container.querySelectorAll("[data-role='feedback']")).toHaveLength(1);
    });
    expect(
      container.querySelector("[data-role='assistant'] [data-role='feedback']"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-role='user'] [data-role='feedback']"),
    ).not.toBeInTheDocument();
  });

  it("shows how the trainer is tuned once a reply says it is", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          coaching: {
            explanationDepth: "brief",
            challenge: "standard",
            sessionLength: "short",
            focus: "balanced",
            news: true,
          },
        }),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(container.querySelector("[data-role='coaching']")).toHaveTextContent(
        /brief explanations · shorter sessions/,
      );
    });
  });

  it("says nothing about tuning for a trainer on its defaults", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          coaching: {
            explanationDepth: "standard",
            challenge: "standard",
            sessionLength: "standard",
            focus: "balanced",
            news: true,
          },
        }),
      ),
    );
    const { container } = render(<TrainerSession />);

    await sendMessage();

    await waitFor(() => {
      expect(screen.getByText(/richtig!/i)).toBeInTheDocument();
    });
    expect(container.querySelector("[data-role='coaching']")).not.toBeInTheDocument();
  });

  it("labels the coaching tool's receipt in plain words", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () =>
        HttpResponse.json({
          ...REPLY,
          steps: [{ tool: "adjust_coaching", summary: "1 setting changed from now on" }],
        }),
      ),
    );
    render(<TrainerSession />);

    await sendMessage();

    expect(await screen.findByText(/adjusted how it coaches you/i)).toBeInTheDocument();
  });
});
