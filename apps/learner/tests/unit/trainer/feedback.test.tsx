import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { ReplyFeedback } from "@/components/trainer/feedback";
import { server } from "@dp/test-support/msw";

/**
 * The vote under a reply.
 *
 * A helpful vote goes straight up. An unhelpful one opens the reasons — the
 * closed set the rules act on — and the confirmation names what moved, so the
 * learner sees their feedback land rather than vanish into a form.
 */

const ENDPOINT = "http://localhost:3000/api/trainer/feedback";

const DIALS = {
  explanationDepth: "brief",
  challenge: "standard",
  sessionLength: "standard",
  focus: "balanced",
  news: true,
};

describe("a helpful vote", () => {
  it("sends the verdict and the tool receipt at once", async () => {
    let sent: unknown = null;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ coaching: DIALS, changed: [] });
      }),
    );
    render(<ReplyFeedback tools={["get_review_session"]} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Helpful" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/thanks/i);
    });
    expect(sent).toEqual({
      verdict: "helpful",
      reasons: [],
      note: "",
      tools: ["get_review_session"],
    });
  });
});

describe("an unhelpful vote", () => {
  it("asks why, sends the chosen reasons and the note, and says what changed", async () => {
    let sent: unknown = null;
    const onCoaching = vi.fn();
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          coaching: DIALS,
          changed: [{ dial: "explanationDepth", from: "standard", to: "brief" }],
        });
      }),
    );
    render(<ReplyFeedback tools={[]} onCoaching={onCoaching} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Not helpful" }));
    await user.click(screen.getByRole("button", { name: "Too long" }));
    await user.type(screen.getByLabelText(/anything else/i), "Skip the second example");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/adjust explanations/i);
    });
    expect(sent).toEqual({
      verdict: "unhelpful",
      reasons: ["too_long"],
      note: "Skip the second example",
      tools: [],
    });
    expect(onCoaching).toHaveBeenCalledWith(DIALS);
  });

  it("offers every reason the rules know", async () => {
    render(<ReplyFeedback tools={[]} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Not helpful" }));

    for (const label of [
      "Too long",
      "Too brief",
      "Too hard",
      "Too easy",
      "Unclear",
      "The correction was wrong",
      "Skip the news",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("says when the note was not kept", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ coaching: DIALS, changed: [], noteDropped: true }),
      ),
    );
    render(<ReplyFeedback tools={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Not helpful" }));
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/note was not kept/i);
    });
  });

  it("shows the server's own sentence when the vote is refused", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { error: "rate_limited", message: "That is a lot of feedback at once." },
          { status: 429 },
        ),
      ),
    );
    render(<ReplyFeedback tools={[]} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Helpful" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/a lot of feedback/i);
    });
  });
});
