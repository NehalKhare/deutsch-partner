import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { Conversation, type ChatMessage } from "@/components/chat/conversation";
import { TUTOR } from "@/domain/tutor";
import { server } from "../../msw/server";

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

function renderConversation(initialMessages: readonly ChatMessage[] = []) {
  return render(
    <Conversation
      threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
      initialMessages={initialMessages}
      miniLevel={1}
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

    expect(await screen.findByText(/mini-level 16/i)).toBeInTheDocument();
    expect(screen.getByText("Verabredungen")).toBeInTheDocument();
  });
});

describe("what the product promises about storage", () => {
  it("says so where a new conversation starts", () => {
    renderConversation();

    expect(screen.getByText(/nothing you say here is stored/i)).toBeInTheDocument();
  });
});
