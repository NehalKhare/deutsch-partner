import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { Conversation, type ChatMessage } from "@/components/chat/conversation";
import { encodeChatTrailer } from "@/lib/api/chat-trailer";
import { TUTOR } from "@dp/domain/tutor";
import { server } from "@dp/test-support/msw";

/**
 * The conversation surface.
 *
 * Two things are worth testing here and neither is the markup: that the
 * learner's own words appear without waiting for a model, and that the
 * companion is doing what is actually happening. The second is the whole
 * reason the character exists — a blob that smiles through a five-second
 * silence is decoration, and one that mouths words while the reply lands is
 * the product telling the truth about its own state.
 */

const CHAT_ENDPOINT = "http://localhost:3000/api/chat";

const encoder = new TextEncoder();

/** A reply whose arrival the test controls chunk by chunk. */
function replyStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    body,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

function renderConversation(
  initialMessages: readonly ChatMessage[] = [],
  extra: { readonly voiceGender?: "male" | "female" } = {},
) {
  return render(
    <Conversation
      threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
      initialMessages={initialMessages}
      miniLevel={1}
      {...extra}
    />,
  );
}

/** The companion is decorative, so it is read the way a stylesheet reads it. */
function companion(container: HTMLElement) {
  const node = container.querySelector("[data-emotion]");
  if (!node) throw new Error("the companion is not on the page");

  return {
    emotion: node.getAttribute("data-emotion"),
    animated: node.getAttribute("data-animated"),
  };
}

describe("what the learner sees", () => {
  it("invites a first message into an empty thread", () => {
    renderConversation();

    expect(screen.getByText(/is enough to start/i)).toBeInTheDocument();
  });

  it("shows the messages the thread already had", () => {
    renderConversation([
      { id: "a", role: "assistant", content: "Wie geht es dir?" },
      { id: "b", role: "user", content: "Gut, danke." },
    ]);

    expect(screen.getByText("Wie geht es dir?")).toBeInTheDocument();
    expect(screen.getByText("Gut, danke.")).toBeInTheDocument();
    expect(screen.queryByText(/is enough to start/i)).not.toBeInTheDocument();
  });

  it("shows an emphasised word as emphasis, not as asterisks", async () => {
    const { container } = renderConversation([
      { id: "a", role: "assistant", content: "Ja, super: **das Buch**." },
    ]);

    expect(container.querySelector("strong")).toHaveTextContent("das Buch");
    expect(container.textContent).not.toContain("**");
  });

  it("shows a numbered list as a list rather than one run-on line", async () => {
    const { container } = renderConversation([
      { id: "a", role: "assistant", content: "Heute:\n1. der\n2. die\n3. das" },
    ]);

    // Scoped to the reply: the transcript itself is a list of messages.
    expect(
      container.querySelectorAll("[data-role='assistant'] ol > li"),
    ).toHaveLength(3);
  });

  it("marks the tutor's German so a screen reader switches voice", () => {
    renderConversation([
      { id: "a", role: "assistant", content: "Wie geht es dir?" },
    ]);

    expect(screen.getByText("Wie geht es dir?")).toHaveAttribute("lang", "de");
  });

  it("will not send an empty message", async () => {
    renderConversation();

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("the companion says what is happening", () => {
  it("rests when nothing is happening", () => {
    const { container } = renderConversation();

    expect(companion(container)).toEqual({
      emotion: "smiling",
      animated: "false",
    });
  });

  it("listens while the learner is typing", async () => {
    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");

    expect(companion(container).emotion).toBe("listening");
  });

  it("goes back to rest when the learner clears what they wrote", async () => {
    const user = userEvent.setup();
    const { container } = renderConversation();

    const box = screen.getByLabelText(/your message in german/i);
    await user.type(box, "Hallo");
    await user.clear(box);

    expect(companion(container).emotion).toBe("smiling");
  });

  it("does not mistake whitespace for a learner who is typing", async () => {
    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "   ");

    expect(companion(container).emotion).toBe("smiling");
  });

  it("listens while the message is in flight, then speaks as the reply lands", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(
      screen.getByLabelText(/your message in german/i),
      "Hallo! Ich heiße Alex.",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    // The learner's own words are on the page while the reply stream is still
    // open and empty — nothing has been enqueued yet, so nothing about this
    // waited on a model.
    expect(await screen.findByText("Hallo! Ich heiße Alex.")).toBeInTheDocument();

    await waitFor(() => {
      expect(companion(container)).toEqual({
        emotion: "listening",
        animated: "false",
      });
    });

    reply.send("Hallo Alex!");

    await waitFor(() => {
      expect(companion(container)).toEqual({
        emotion: "smiling",
        animated: "true",
      });
    });

    reply.end();

    await waitFor(() => {
      expect(companion(container).animated).toBe("false");
    });
    expect(screen.getByText("Hallo Alex!")).toBeInTheDocument();
  });

  it("stops speaking when the reply never arrives", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        HttpResponse.json({ message: "Your tutor is unavailable." }, { status: 503 }),
      ),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your tutor is unavailable.",
      );
    });
    expect(companion(container).animated).toBe("false");
  });
});

describe("the reply as it arrives", () => {
  it("shows each piece as it lands, not the whole paragraph at the end", async () => {
    // The property the component was restructured for. Asserted on the DOM
    // rather than on state, because a bubble that stops rendering is exactly
    // the silence this was meant to remove.
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    reply.send("Guten ");
    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).toHaveTextContent(
        "Guten",
      );
    });

    // And the pieces accumulate rather than replacing one another.
    reply.send("Tag, Alex!");
    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).toHaveTextContent(
        "Guten Tag, Alex!",
      );
    });

    reply.end();
    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Guten Tag, Alex!")).toBeInTheDocument();
  });

  it("keeps the finished reply as one message, not one per chunk", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    reply.send("Guten ");
    reply.send("Tag");
    reply.end();

    await waitFor(() => {
      expect(container.querySelectorAll("[data-role='assistant']")).toHaveLength(1);
    });
  });
});

describe("the transcript follows the conversation", () => {
  /**
   * The test DOM lays nothing out and scrolls nothing, so the sentinel's
   * place in the viewport is declared, and scrollIntoView is given a body
   * that records the call.
   */
  function sentinelOf(container: HTMLElement, bottom: number) {
    const end = container.querySelector("[data-transcript-end]") as HTMLElement | null;
    if (!end) throw new Error("the end of the transcript is not on the page");

    Object.defineProperty(end, "getBoundingClientRect", {
      value: () => ({ top: bottom, bottom, left: 0, right: 0, width: 0, height: 0 }),
      configurable: true,
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(end, "scrollIntoView", { value: scrollIntoView, configurable: true });

    return { end, scrollIntoView };
  }

  it("scrolls to the reply as it arrives", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();
    const { scrollIntoView } = sentinelOf(container, 700);

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    reply.send("Guten Tag!");
    reply.end();

    await waitFor(() => {
      expect(screen.getByText("Guten Tag!")).toBeInTheDocument();
    });

    // Once for the learner's own message, then for the reply: the end of
    // the conversation was brought into view every time it moved.
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "end" });
  });

  it("leaves a learner who scrolled up to read where they are", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation([
      { id: "a", role: "assistant", content: "Wie geht es dir?" },
    ]);
    // The end of the conversation is far below the viewport, and the learner
    // said so by scrolling.
    const { scrollIntoView } = sentinelOf(container, 5000);
    fireEvent.scroll(document);
    scrollIntoView.mockClear();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    reply.send("Guten Tag!");
    reply.end();

    await waitFor(() => {
      expect(screen.getByText("Guten Tag!")).toBeInTheDocument();
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("a turn the server refused", () => {
  const refuse = () =>
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        HttpResponse.json({ message: "Too many messages. Wait a moment." }, { status: 429 }),
      ),
    );

  async function sendAndFail(text: string) {
    refuse();
    const user = userEvent.setup();
    const rendered = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), text);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    return { user, ...rendered };
  }

  it("takes the message back out of the conversation", async () => {
    // The server never saved it. A bubble that looks delivered, is not, and
    // disappears on the next reload is worse than no bubble at all.
    const { container } = await sendAndFail("Ich möchte einen Kaffee.");

    expect(container.querySelectorAll("[data-role='user']")).toHaveLength(0);
  });

  it("puts the learner's sentence back in the box", async () => {
    await sendAndFail("Ich möchte einen Kaffee.");

    expect(screen.getByLabelText(/your message in german/i)).toHaveValue(
      "Ich möchte einen Kaffee.",
    );
  });

  it("does not send the same sentence twice when the learner tries again", async () => {
    const { container } = await sendAndFail("Ich möchte einen Kaffee.");

    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse("Gern geschehen!", { status: 200 })),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Gern geschehen!")).toBeInTheDocument();
    });
    expect(container.querySelectorAll("[data-role='user']")).toHaveLength(1);
  });

  it("does not overwrite a second thought typed while the turn was in flight", async () => {
    // The restore only fills an empty box. Somebody who has already started
    // typing something else must not have it replaced by the sentence that
    // failed a moment ago.
    let refuse: () => void = () => undefined;
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new Promise<Response>((resolve) => {
            refuse = () =>
              resolve(
                HttpResponse.json({ message: "Too many messages." }, { status: 429 }),
              );
          }),
      ),
    );

    const user = userEvent.setup();
    renderConversation();
    const box = screen.getByLabelText(/your message in german/i);

    await user.type(box, "Ich möchte einen Kaffee.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(box).toHaveValue(""));

    await user.type(box, "Nein, einen Tee.");
    refuse();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(box).toHaveValue("Nein, einen Tee.");
  });
});

describe("a turn the plan refused", () => {
  // billing-and-plans-spec.md S4: a refused request returns the draft, says
  // when the window reopens, and says that progress is saved — as an upgrade
  // prompt, never as the red alert that means the turn broke.
  const refusal = (over: Record<string, unknown> = {}) => ({
    error: "quota_exhausted",
    message: "You've used today's tutor turns.",
    resetAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    upgrade: true,
    ...over,
  });

  async function sendAndRefuse(body: Record<string, unknown>, status = 429) {
    server.use(http.post(CHAT_ENDPOINT, () => HttpResponse.json(body, { status })));
    const user = userEvent.setup();
    const rendered = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Ich möchte einen Kaffee.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText(String(body.message))).toBeInTheDocument());

    return { user, ...rendered };
  }

  it("shows an upgrade prompt in place of the red alert", async () => {
    await sendAndRefuse(refusal());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/your progress is saved/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
  });

  it("says it in a live region that was on the page before it, so a screen reader hears it", async () => {
    // A polite region inserted already holding its text is often not
    // announced at all; one that is there first and then fills is.
    server.use(http.post(CHAT_ENDPOINT, () => HttpResponse.json(refusal(), { status: 429 })));
    const user = userEvent.setup();
    const { container } = renderConversation();
    const region = container.querySelector("[data-live='plan']");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    await user.type(screen.getByLabelText(/your message in german/i), "Ich möchte einen Kaffee.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(region).toHaveTextContent("You've used today's tutor turns."));
    expect(container.querySelector("[data-live='plan']")).toBe(region);
  });

  it("keeps the learner's sentence in the box and out of the conversation", async () => {
    const { container } = await sendAndRefuse(refusal());

    expect(screen.getByLabelText(/your message in german/i)).toHaveValue("Ich möchte einen Kaffee.");
    expect(container.querySelectorAll("[data-role='user']")).toHaveLength(0);
  });

  it("sells a Premium learner nothing", async () => {
    await sendAndRefuse(refusal({ upgrade: false }));

    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your progress is saved/i)).toBeInTheDocument();
  });

  it("says a spent allowance the same way", async () => {
    await sendAndRefuse(
      refusal({
        error: "budget_exhausted",
        message: "You've used your AI allowance for now.",
        resetAt: "2026-11-01T00:00:00.000Z",
      }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/renews on/i)).toBeInTheDocument();
  });

  it("clears the prompt once a turn goes through", async () => {
    const { user } = await sendAndRefuse(refusal());

    server.use(http.post(CHAT_ENDPOINT, () => new HttpResponse("Gern geschehen!", { status: 200 })));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Gern geschehen!")).toBeInTheDocument());
    expect(screen.queryByText("You've used today's tutor turns.")).not.toBeInTheDocument();
  });

  it("keeps an ordinary refusal the red alert it always was", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        HttpResponse.json({ error: "rate_limited", message: "Too many messages." }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many messages."));
    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
  });
});

describe("what a screen reader is told", () => {
  it("says nothing is happening when nothing is", () => {
    renderConversation();

    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says a reply is coming, so the wait is not silence", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        `${TUTOR.name} is replying.`,
      );
    });

    reply.send("Hallo Alex!");
    reply.end();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("");
    });
  });

  it("names the tutor the learner's voice belongs to", async () => {
    // The female voice is Alex, not Jonas read out by a woman: the name on
    // screen has to be the same person the reply is spoken by.
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    renderConversation([], { voiceGender: "female" });

    expect(screen.getByText(/Alex is waiting/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Alex is replying.");
    });

    reply.end();
  });

  it("does not read the reply out again on every chunk", async () => {
    // The list is a polite live region so the finished reply is announced once.
    // The bubble that is still filling in must opt out of it, or a screen
    // reader reads the same growing half-sentence over and over.
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    reply.send("Guten Tag");

    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).toHaveAttribute(
        "aria-live",
        "off",
      );
    });

    reply.end();

    // The finished message carries no opt-out, so the polite region reads it
    // exactly once.
    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Guten Tag")).not.toHaveAttribute("aria-live");
  });
});

describe("when the server refuses", () => {
  it("says something a learner can act on and nothing internal", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        HttpResponse.json({ message: "Too many messages. Wait a moment." }, { status: 429 }),
      ),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Too many messages. Wait a moment.",
      );
    });
  });

  it("falls back to a plain sentence when the refusal carries no message", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse("", { status: 500 })),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    });
  });
});

describe("what travels with a turn", () => {
  /** Captures the JSON body the component actually sent. */
  function captureBody() {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(CHAT_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse("Alles klar!", { status: 200 });
      }),
    );
    return captured;
  }

  it("carries the transcript, because the server has no copy of it", async () => {
    const captured = captureBody();
    const user = userEvent.setup();
    renderConversation([
      { id: "a", role: "assistant", content: "Wie geht es dir?" },
      { id: "b", role: "user", content: "Gut, danke." },
    ]);

    await user.type(screen.getByLabelText(/your message in german/i), "Und dir?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]).toMatchObject({
      message: "Und dir?",
      history: [
        { role: "assistant", content: "Wie geht es dir?" },
        { role: "user", content: "Gut, danke." },
      ],
    });
  });

  it("sends the newest window of a long conversation, never all of it", async () => {
    const captured = captureBody();
    const user = userEvent.setup();
    const long: ChatMessage[] = Array.from({ length: 11 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Satz ${index}`,
    }));
    renderConversation(long);

    await user.type(screen.getByLabelText(/your message in german/i), "Noch einer");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    const history = captured[0]?.history as Array<{ content: string }>;

    expect(history).toHaveLength(8);
    expect(history[0]?.content).toBe("Satz 3");
    expect(history[7]?.content).toBe("Satz 10");
  });

  it("pins a scenario seed into the window of a long conversation", async () => {
    // The seed is the scene itself — the roles, or the whole reading passage.
    // Once the conversation outgrows the window it takes the oldest slot
    // rather than falling out: a tutor asking questions about a passage it
    // can no longer see grades the learner against its own invention.
    const captured = captureBody();
    const user = userEvent.setup();
    const long: ChatMessage[] = [
      { id: "scenario:im-cafe", role: "assistant", content: "Leseverstehen: der Text." },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `m-${index}`,
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Satz ${index}`,
      })),
    ];
    renderConversation(long);

    await user.type(screen.getByLabelText(/your message in german/i), "Noch einer");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    const history = captured[0]?.history as Array<{ content: string }>;

    // Still exactly the window the server accepts, with the seed first.
    expect(history).toHaveLength(8);
    expect(history[0]?.content).toBe("Leseverstehen: der Text.");
    expect(history[7]?.content).toBe("Satz 9");
  });

  it("does not duplicate a seed that is still inside the window", async () => {
    const captured = captureBody();
    const user = userEvent.setup();
    renderConversation([
      { id: "scenario:im-cafe", role: "assistant", content: "Rollenspiel: die Szene." },
      { id: "m-0", role: "user", content: "Hallo!" },
    ]);

    await user.type(screen.getByLabelText(/your message in german/i), "Weiter");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    const history = captured[0]?.history as Array<{ content: string }>;

    expect(history.map((line) => line.content)).toEqual([
      "Rollenspiel: die Szene.",
      "Hallo!",
    ]);
  });

  it("pins nothing in an ordinary conversation", async () => {
    // A plain first message is not a scene; the window slides as it always
    // did, and the server sees no difference.
    const captured = captureBody();
    const user = userEvent.setup();
    const long: ChatMessage[] = Array.from({ length: 9 }, (_, index) => ({
      id: `m-${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Satz ${index}`,
    }));
    renderConversation(long);

    await user.type(screen.getByLabelText(/your message in german/i), "Noch einer");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    const history = captured[0]?.history as Array<{ content: string }>;

    expect(history[0]?.content).toBe("Satz 1");
  });

  it("keeps the message being sent out of the history it sends", async () => {
    // The message travels in its own field. Doubling it into the transcript
    // would make the tutor read everything twice.
    const captured = captureBody();
    const user = userEvent.setup();
    renderConversation();

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo!");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]?.history).toEqual([]);
  });

  it("sends nothing but role and content for each line", async () => {
    // The server's schema is strict, and ids are client bookkeeping.
    const captured = captureBody();
    const user = userEvent.setup();
    renderConversation([{ id: "a", role: "assistant", content: "Hallo!" }]);

    await user.type(screen.getByLabelText(/your message in german/i), "Hallo!");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    const line = (captured[0]?.history as unknown[])[0];

    expect(Object.keys(line as Record<string, unknown>).sort()).toEqual([
      "content",
      "role",
    ]);
  });
});

describe("moving on by button", () => {
  it("sends the same request the words would, through the same door", async () => {
    // The button is a visible handle on the door "weiter" opens. It must not
    // be a second code path: the server owns the move either way.
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(CHAT_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse("Super, weiter geht's!", { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.click(
      screen.getByRole("button", { name: /next mini-level/i }),
    );

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]?.message).toBe("Weiter bitte!");
    expect(screen.getByText("Weiter bitte!")).toBeInTheDocument();
  });

  it("cannot fire twice into one turn", async () => {
    const reply = replyStream();
    server.use(
      http.post(CHAT_ENDPOINT, () => new HttpResponse(reply.body, { status: 200 })),
    );

    const user = userEvent.setup();
    renderConversation();

    const button = screen.getByRole("button", { name: /next mini-level/i });
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    reply.end();
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("the tutor's place on the page", () => {
  it("sits in the header, before a word has been said", () => {
    const { container } = render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        title="Wie geht es dir?"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    // The face, the room's name and the position label are one unit at the
    // top — and the composer no longer carries a second copy of the face.
    const header = container.querySelector("header");
    expect(header?.querySelector("[data-emotion]")).not.toBeNull();
    expect(container.querySelector("form [data-emotion]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Wie geht es dir?" })).toBeInTheDocument();
  });
});

describe("where the learner stands", () => {
  it("names the mini-level being taught, so next is not a leap in the dark", () => {
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    expect(screen.getByText(/mini-level 15/i)).toBeInTheDocument();
    expect(screen.getByText("Wie geht es dir?")).toBeInTheDocument();
  });

  it("moves the label the moment the server says the level moved", async () => {
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse("Super, weiter geht's!", {
            status: 200,
            headers: {
              "x-mini-level": "16",
              "x-mini-level-theme": encodeURIComponent("Verabredungen"),
            },
          }),
      ),
    );

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    await user.click(screen.getByRole("button", { name: /next mini-level/i }));

    // The move is said twice on purpose: the position label under the
    // heading, and a milestone seam in the conversation flow itself.
    const said = await screen.findAllByText(/mini-level 16/i);
    expect(said.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Verabredungen").length).toBeGreaterThanOrEqual(1);
  });

  it("marks the move as a milestone in the conversation flow", async () => {
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse("Super, weiter geht's!", {
            status: 200,
            headers: {
              "x-mini-level": "16",
              "x-mini-level-theme": encodeURIComponent("Verabredungen"),
            },
          }),
      ),
    );

    const user = userEvent.setup();
    const { container } = render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    await user.click(screen.getByRole("button", { name: /next mini-level/i }));
    await waitFor(() => {
      expect(container.querySelector("[data-role='milestone']")).toBeInTheDocument();
    });

    const milestone = container.querySelector("[data-role='milestone']");
    expect(milestone).toHaveTextContent(/moving up/i);
    expect(milestone).toHaveTextContent("Mini-level 16");
    expect(milestone).toHaveTextContent("Verabredungen");
  });

  it("renames the room to the topic now being practised", async () => {
    // Threads are titled by the theme they were opened for, so a heading
    // still naming the old topic would contradict every reply under it.
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse("Super, weiter geht's!", {
            status: 200,
            headers: {
              "x-mini-level": "16",
              "x-mini-level-theme": encodeURIComponent("Verabredungen"),
            },
          }),
      ),
    );

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        title="Wie geht es dir?"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    expect(screen.getByRole("heading", { name: "Wie geht es dir?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next mini-level/i }));

    expect(
      await screen.findByRole("heading", { name: "Verabredungen" }),
    ).toBeInTheDocument();
  });

  it("keeps milestones out of the transcript it sends", async () => {
    // The server's schema knows only the two speaking roles, and a milestone
    // is a line nobody spoke.
    const captured: Array<Record<string, unknown>> = [];
    let calls = 0;
    server.use(
      http.post(CHAT_ENDPOINT, async ({ request }) => {
        calls += 1;
        captured.push((await request.json()) as Record<string, unknown>);
        return calls === 1
          ? new HttpResponse("Super!", {
              status: 200,
              headers: {
                "x-mini-level": "16",
                "x-mini-level-theme": encodeURIComponent("Verabredungen"),
              },
            })
          : new HttpResponse("Weiter geht's!", { status: 200 });
      }),
    );

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={15}
        theme="Wie geht es dir?"
      />,
    );

    await user.click(screen.getByRole("button", { name: /next mini-level/i }));
    await waitFor(() => expect(screen.getByText("Super!")).toBeInTheDocument());

    await user.type(screen.getByLabelText(/your message in german/i), "Gern!");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(captured).toHaveLength(2));
    const history = captured[1]?.history as Array<{ role: string }>;
    expect(history.map((line) => line.role)).toEqual(["user", "assistant"]);
  });
});

describe("what the product promises about storage", () => {
  it("says so where a new conversation starts", () => {
    renderConversation();

    expect(screen.getByText(/nothing you say here is stored/i)).toBeInTheDocument();
  });
});

describe("progress towards mastery", () => {
  // A real Storage, in memory. Node can expose a half-built localStorage
  // global that shadows jsdom's (typeof "object", no methods), and a test
  // that depends on which one wins is a test that fails per machine.
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  /** A finished turn: the reply, then the tally trailer, then the close. */
  function replyWithTally(
    text: string,
    tally: { miniLevel: number; turns: number; strongTurns: number },
  ) {
    return new HttpResponse(`${text}${encodeChatTrailer({ tally })}`, {
      status: 200,
    });
  }

  async function sendMessage(text = "Ich heiße Alex und wohne in Berlin.") {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your message in german/i), text);
    await user.click(screen.getByRole("button", { name: "Send" }));
  }

  it("starts from the tally the server already holds", () => {
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={1}
        initialTally={{ turns: 5, strongTurns: 3 }}
      />,
    );

    // Pre-floor, 3 error-free turns are 3 sevenths of the bar.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "43");
    expect(screen.getByText("5 of 7 evaluated turns")).toBeInTheDocument();
  });

  it("moves the bar and credits the turn when the tally arrives", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        replyWithTally("Sehr gut!", { miniLevel: 1, turns: 1, strongTurns: 1 }),
      ),
    );
    const { container } = renderConversation();

    await sendMessage();

    // One error-free turn is one seventh of the bar, not a full one.
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "14");
    });
    expect(container.querySelector("[data-turn-quality='strong']")).toBeInTheDocument();
  });

  it("drops the bar and names the errors when a turn was weak", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        replyWithTally("Fast! Es heißt: mit dem Zug.", {
          miniLevel: 1,
          turns: 8,
          strongTurns: 5,
        }),
      ),
    );
    const { container } = render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={1}
        initialTally={{ turns: 7, strongTurns: 5 }}
      />,
    );

    // 5 of 7 strong is ~0.71 against the 0.8 target.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "89");
    await sendMessage("Ich fahre mit den Zug.");

    // 5 of 8 strong is ~0.63 against the 0.8 target.
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "78");
    });
    expect(container.querySelector("[data-turn-quality='weak']")).toBeInTheDocument();
  });

  it("never lets the trailer leak into the tutor's bubble", async () => {
    server.use(
      http.post(CHAT_ENDPOINT, () =>
        replyWithTally("Sehr gut!", { miniLevel: 1, turns: 1, strongTurns: 1 }),
      ),
    );
    renderConversation();

    await sendMessage();

    expect(await screen.findByText("Sehr gut!")).toBeInTheDocument();
    expect(screen.getByText("Sehr gut!").textContent).toBe("Sehr gut!");
  });

  it("starts the strip over when the learner moves to a new level", async () => {
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse("Super, weiter geht's!", {
            status: 200,
            headers: {
              "x-mini-level": "2",
              "x-mini-level-theme": encodeURIComponent("Woher kommst du?"),
            },
          }),
      ),
    );
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={1}
        initialTally={{ turns: 7, strongTurns: 6 }}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /next mini-level/i }));

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });
    expect(screen.getByText("0 of 7 evaluated turns")).toBeInTheDocument();
  });

  it("clears the last verdict the moment a new turn starts", async () => {
    const first = replyWithTally("Sehr gut!", {
      miniLevel: 1,
      turns: 1,
      strongTurns: 1,
    });
    const reply = replyStream();
    let calls = 0;
    server.use(
      http.post(CHAT_ENDPOINT, () => {
        calls += 1;
        return calls === 1 ? first : new HttpResponse(reply.body, { status: 200 });
      }),
    );
    const { container } = renderConversation();

    await sendMessage();
    await waitFor(() => {
      expect(container.querySelector("[data-turn-quality]")).toBeInTheDocument();
    });

    await sendMessage("Und ich wohne in Berlin.");
    await waitFor(() => {
      expect(container.querySelector("[data-turn-quality]")).not.toBeInTheDocument();
    });
    reply.end();
  });

  it("hides on request and stays hidden across a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = renderConversation();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show progress/i }));

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("deutsch-partner.mastery-strip")).toBe(
      "hidden",
    );

    // The next visit respects the choice without being asked again.
    unmount();
    renderConversation();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });

  it("comes back when asked, and remembers that too", async () => {
    window.localStorage.setItem("deutsch-partner.mastery-strip", "hidden");
    const user = userEvent.setup();
    renderConversation();

    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /show progress/i }));

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(window.localStorage.getItem("deutsch-partner.mastery-strip")).toBe(
      "shown",
    );
  });
});

describe("a scene thread", () => {
  const SCENE = { mode: "roleplay" as const, title: "Im Restaurant" };

  function renderScene(initialTally?: { turns: number; strongTurns: number }) {
    return render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        title="Im Restaurant"
        miniLevel={9}
        theme="Einkaufen"
        scene={SCENE}
        initialTally={initialTally}
      />,
    );
  }

  it("names the scene where a lesson names its level", () => {
    renderScene();

    expect(screen.getByText(/roleplay/i)).toBeInTheDocument();
    expect(screen.getByText(/not counted towards your level/i)).toBeInTheDocument();
    expect(screen.queryByText(/mini-level 9/i)).not.toBeInTheDocument();
  });

  it("draws none of the path: no next-level button, no progress, no offer", () => {
    // Even handed a tally that would clear the level: a scene has no level
    // to clear, and the server never sends one anyway.
    renderScene({ turns: 7, strongTurns: 7 });

    expect(screen.queryByRole("button", { name: /next mini-level/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show progress/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/cleared/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move on" })).not.toBeInTheDocument();
  });

  it("draws no move into the scene, whatever headers arrive", async () => {
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse("Gern, hier ist die Karte.", {
            status: 200,
            headers: {
              "x-mini-level": "10",
              "x-mini-level-theme": encodeURIComponent("Im Café"),
            },
          }),
      ),
    );

    const user = userEvent.setup();
    const { container } = renderScene();

    await user.type(screen.getByLabelText(/your message in german/i), "Weiter bitte!");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Gern, hier ist die Karte.");

    expect(container.querySelector("[data-role='milestone']")).not.toBeInTheDocument();
    expect(screen.queryByText(/mini-level 10/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Im Restaurant" })).toBeInTheDocument();
  });
});

describe("the cleared-level offer", () => {
  function renderCleared(initialTally = { turns: 7, strongTurns: 6 }) {
    return render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={1}
        theme="Hallo und Tschüss"
        initialTally={initialTally}
      />,
    );
  }

  it("announces a level the stored tally already shows as cleared", () => {
    renderCleared();

    expect(screen.getByText(/mini-level 1 cleared/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move on" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep practising" }),
    ).toBeInTheDocument();
  });

  it("offers nothing while the level is not cleared", () => {
    renderCleared({ turns: 5, strongTurns: 3 });

    expect(screen.queryByText(/cleared/i)).not.toBeInTheDocument();
  });

  it("honours the learner's own pass mark, and says which bar it was", () => {
    // The same 4-of-7 tally that says nothing at the default clears a 50%
    // bar — and the banner names the bar, so the praise is never mysterious.
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        miniLevel={1}
        theme="Hallo und Tschüss"
        initialTally={{ turns: 7, strongTurns: 4 }}
        masteryThreshold={50}
      />,
    );

    expect(screen.getByText(/mini-level 1 cleared/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 50% of your turns/i)).toBeInTheDocument();
  });

  it("appears the moment a turn's tally opens the gate", async () => {
    server.use(
      http.post(
        CHAT_ENDPOINT,
        () =>
          new HttpResponse(
            `Sehr gut!${encodeChatTrailer({
              tally: { miniLevel: 1, turns: 7, strongTurns: 6 },
            })}`,
            { status: 200 },
          ),
      ),
    );
    const user = userEvent.setup();
    renderCleared({ turns: 6, strongTurns: 5 });

    expect(screen.queryByText(/cleared/i)).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/your message in german/i),
      "Ich heiße Alex und wohne in Berlin.",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/mini-level 1 cleared/i)).toBeInTheDocument();
  });

  it("keeps practising when asked to, without sending anything", async () => {
    const requests: number[] = [];
    server.use(
      http.post(CHAT_ENDPOINT, () => {
        requests.push(1);
        return new HttpResponse("Gern!", { status: 200 });
      }),
    );
    const user = userEvent.setup();
    renderCleared();

    await user.click(screen.getByRole("button", { name: "Keep practising" }));

    expect(screen.queryByText(/cleared/i)).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
    // The tutor is still there and the level has not moved.
    expect(screen.getByText(/mini-level 1/i)).toBeInTheDocument();
  });

  it("moves on through the same door the words would open", async () => {
    const captured: Array<Record<string, unknown>> = [];
    server.use(
      http.post(CHAT_ENDPOINT, async ({ request }) => {
        captured.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse("Willkommen auf Mini-Level 2!", {
          status: 200,
          headers: {
            "x-mini-level": "2",
            "x-mini-level-theme": encodeURIComponent("Woher kommst du?"),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderCleared();

    await user.click(screen.getByRole("button", { name: "Move on" }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]?.message).toBe("Weiter bitte!");

    // The offer closes once the move lands: the new level has no tally yet.
    await waitFor(() => {
      expect(screen.queryByText(/cleared/i)).not.toBeInTheDocument();
    });
  });
});
