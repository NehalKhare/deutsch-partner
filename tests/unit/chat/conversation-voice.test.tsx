import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { Conversation, type ChatMessage } from "@/components/chat/conversation";
import type {
  Recording,
  SpeechCapture,
  SpeechPlayback,
  SpeechVoice,
} from "@/components/chat/speech";
import { SPEECH_RATES } from "@/lib/ai/voice/providers";
import { server } from "../../msw/server";

/**
 * Speaking to the tutor, and hearing it back.
 *
 * jsdom has neither MediaRecorder nor a working HTMLAudioElement, which is why
 * both arrive as ports. These fakes stand in for them, and the assertions are
 * about the things that would be wrong in a real browser too: that the
 * microphone is always released, that a transcript is shown before it is sent,
 * and that the companion is doing what is actually happening.
 */

const TRANSCRIBE = "http://localhost:3000/api/transcribe";
const SPEAK = "http://localhost:3000/api/speak";

const REPLY: ChatMessage = {
  id: "reply-1",
  role: "assistant",
  content: "Wie geht es dir?",
};

function fakeCapture(over: Partial<SpeechCapture> = {}) {
  const events: string[] = [];
  const capture: SpeechCapture & { events: string[] } = {
    events,
    supported: () => true,
    async start() {
      events.push("start");
    },
    async stop(): Promise<Recording> {
      events.push("stop");
      return { audio: new Blob(["audio"], { type: "audio/webm" }), durationMs: 2500 };
    },
    cancel() {
      events.push("cancel");
    },
    ...over,
  };
  return capture;
}

function fakePlayback(over: Partial<SpeechPlayback> = {}) {
  const played: Blob[] = [];
  let finish: (() => void) | null = null;
  const playback: SpeechPlayback & {
    played: Blob[];
    finish: () => void;
  } = {
    played,
    finish: () => finish?.(),
    supported: () => true,
    play(audio: Blob) {
      played.push(audio);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    stop() {
      finish?.();
      finish = null;
    },
    ...over,
  };
  return playback;
}

function renderConversation(
  options: {
    messages?: readonly ChatMessage[];
    capture?: SpeechCapture;
    playback?: SpeechPlayback;
  } = {},
) {
  return render(
    <Conversation
      threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
      initialMessages={options.messages ?? []}
      miniLevel={1}
      cefr="A2"
      capture={options.capture ?? fakeCapture()}
      playback={options.playback ?? fakePlayback()}
    />,
  );
}

const box = () => screen.getByLabelText(/your message in german/i);
const companion = (container: HTMLElement) => ({
  emotion: container.querySelector("[data-emotion]")?.getAttribute("data-emotion"),
  animated: container.querySelector("[data-emotion]")?.getAttribute("data-animated"),
});

describe("speaking to the tutor", () => {
  it("offers a microphone when the browser has one", () => {
    renderConversation();

    expect(screen.getByRole("button", { name: /speak your message/i })).toBeEnabled();
  });

  it("offers no microphone when the browser has none", () => {
    renderConversation({ capture: fakeCapture({ supported: () => false }) });

    expect(screen.queryByRole("button", { name: /speak your message/i })).toBeNull();
  });

  it("puts what was heard in the box rather than sending it", async () => {
    // A learner has to see what was heard before it becomes something they
    // said. A misheard word is the thing they are here to notice.
    const sent = vi.fn();
    server.use(
      http.post(TRANSCRIBE, () => HttpResponse.json({ text: "Ich heiße Alex." })),
      http.post("http://localhost:3000/api/chat", () => {
        sent();
        return new HttpResponse("", { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.click(screen.getByRole("button", { name: /speak your message/i }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(box()).toHaveValue("Ich heiße Alex."));
    expect(sent).not.toHaveBeenCalled();
  });

  it("adds to what the learner had already typed", async () => {
    server.use(http.post(TRANSCRIBE, () => HttpResponse.json({ text: "und du?" })));

    const user = userEvent.setup();
    renderConversation();

    await user.type(box(), "Mir geht es gut");
    await user.click(screen.getByRole("button", { name: /speak your message/i }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(box()).toHaveValue("Mir geht es gut und du?"));
  });

  it("listens, visibly, while the learner is talking", async () => {
    const user = userEvent.setup();
    const { container } = renderConversation();

    await user.click(screen.getByRole("button", { name: /speak your message/i }));

    expect(companion(container).emotion).toBe("listening");
  });

  it("releases the microphone when the page goes away", () => {
    // A page that leaves the recording indicator lit is a page nobody trusts
    // with a microphone twice.
    const capture = fakeCapture();
    const { unmount } = renderConversation({ capture });

    unmount();

    expect(capture.events).toContain("cancel");
  });

  it("says so plainly when the microphone is refused", async () => {
    const capture = fakeCapture({
      start: async () => {
        throw new Error("NotAllowedError");
      },
    });
    const user = userEvent.setup();
    renderConversation({ capture });

    await user.click(screen.getByRole("button", { name: /speak your message/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not reach your microphone/i)).toBeInTheDocument();
    });
    // And it did not pretend to be recording.
    expect(
      screen.getByRole("button", { name: /speak your message/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the server's own refusal rather than a generic one", async () => {
    server.use(
      http.post(TRANSCRIBE, () =>
        HttpResponse.json(
          { error: "audio_too_long", message: "Recordings are limited to 60 seconds." },
          { status: 413 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.click(screen.getByRole("button", { name: /speak your message/i }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => {
      expect(screen.getByText(/limited to 60 seconds/i)).toBeInTheDocument();
    });
    expect(box()).toHaveValue("");
  });

  it("does not raise the turn-failed banner for a voice problem", async () => {
    // Voice is an addition to the conversation, not the conversation. The red
    // alert means "your turn did not happen", and it did not happen here.
    server.use(
      http.post(TRANSCRIBE, () => HttpResponse.json({}, { status: 503 })),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.click(screen.getByRole("button", { name: /speak your message/i }));
    await user.click(screen.getByRole("button", { name: /stop recording/i }));

    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

function fakeVoice(
  over: Partial<SpeechVoice> & {
    /** Records the line and then keeps talking, so a stop can be observed. */
    hold?: boolean;
  } = {},
) {
  const spoken: Array<{ text: string; rate: number }> = [];
  // Stops are recorded, not swallowed: "did anything actually silence it" is
  // the question a test of a voice most needs to be able to ask.
  let stops = 0;
  const { hold, ...overrides } = over;

  const voice: SpeechVoice & { spoken: typeof spoken; stops: () => number } = {
    spoken,
    stops: () => stops,
    supported: () => true,
    speak(text: string, rate: number) {
      spoken.push({ text, rate });
      return hold ? new Promise<void>(() => {}) : Promise.resolve();
    },
    stop() {
      stops += 1;
    },
    ...overrides,
  };
  return voice;
}

describe("the browser's own voice", () => {
  it("reads the reply when the server has no voice configured", async () => {
    // The state this product is in until somebody adds a speech key: the
    // route answers 503 and the reply is read anyway.
    server.use(
      http.post(SPEAK, () =>
        HttpResponse.json(
          { error: "voice_unavailable", message: "Speaking is not available right now." },
          { status: 503 },
        ),
      ),
    );

    const voice = fakeVoice();
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A1"
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(voice.spoken[0]).toEqual({ text: "Wie geht es dir?", rate: SPEECH_RATES.A1 });
  });

  it("reads more slowly for a beginner than for B1", async () => {
    server.use(http.post(SPEAK, () => HttpResponse.json({}, { status: 503 })));

    const voice = fakeVoice();
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="B1"
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(voice.spoken[0]?.rate).toBe(SPEECH_RATES.B1);
    expect(SPEECH_RATES.A1).toBeLessThan(SPEECH_RATES.B1);
  });

  it("prefers the speech model when there is one", async () => {
    server.use(http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))));

    const voice = fakeVoice();
    const playback = fakePlayback();
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A1"
        capture={fakeCapture()}
        playback={playback}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(playback.played).toHaveLength(1));
    expect(voice.spoken).toHaveLength(0);
  });

  it("still offers to read aloud when only the browser can speak", () => {
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        capture={fakeCapture()}
        playback={fakePlayback({ supported: () => false })}
        voice={fakeVoice()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /read replies aloud/i }),
    ).toBeInTheDocument();
  });

  it("goes quiet when the learner presses stop", async () => {
    server.use(http.post(SPEAK, () => HttpResponse.json({}, { status: 503 })));

    const voice = fakeVoice({ hold: true });
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /stop reading this reply/i }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /stop reading this reply/i }));

    expect(voice.stops()).toBeGreaterThan(0);
  });

  it("goes quiet when the page goes away mid-sentence", async () => {
    // A tutor that carries on talking after the learner has navigated away is
    // a browser tab they will close rather than a feature they will use.
    server.use(http.post(SPEAK, () => HttpResponse.json({}, { status: 503 })));

    const voice = fakeVoice({ hold: true });
    const user = userEvent.setup();
    const { unmount } = render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));
    await waitFor(() => expect(voice.spoken).toHaveLength(1));

    unmount();

    expect(voice.stops()).toBeGreaterThan(0);
  });

  it("says so only when neither can speak", async () => {
    server.use(http.post(SPEAK, () => HttpResponse.json({}, { status: 503 })));

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={fakeVoice({
          speak: async () => {
            throw new Error("no voice here");
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not be read aloud/i)).toBeInTheDocument();
    });
  });
});

describe("hearing the tutor", () => {
  it("reads a reply aloud when asked", async () => {
    server.use(http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))));

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ messages: [REPLY], playback });

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(playback.played).toHaveLength(1));
  });

  it("asks for it at the level the thread is being taught at", async () => {
    let body: unknown;
    server.use(
      http.post(SPEAK, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(new Blob(["mp3"]));
      }),
    );

    const user = userEvent.setup();
    renderConversation({ messages: [REPLY] });

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() =>
      expect(body).toEqual({ text: "Wie geht es dir?", cefr: "A2", voice: "male" }),
    );
  });

  it("speaks, visibly, while the reply is being read", async () => {
    server.use(http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))));

    const playback = fakePlayback();
    const user = userEvent.setup();
    const { container } = renderConversation({ messages: [REPLY], playback });

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => {
      expect(companion(container)).toEqual({ emotion: "smiling", animated: "true" });
    });

    playback.finish();

    await waitFor(() => expect(companion(container).animated).toBe("false"));
  });

  it("stops when asked again, rather than starting a second copy", async () => {
    server.use(http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))));

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ messages: [REPLY], playback });

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop reading this reply/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /stop reading this reply/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /read this reply aloud/i })).toBeInTheDocument(),
    );
    expect(playback.played).toHaveLength(1);
  });

  it("stays quiet about a reply it could not read", async () => {
    server.use(http.post(SPEAK, () => HttpResponse.json({}, { status: 503 })));

    const user = userEvent.setup();
    renderConversation({ messages: [REPLY] });

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not be read aloud/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no read-aloud controls when the browser cannot play audio", () => {
    renderConversation({
      messages: [REPLY],
      playback: fakePlayback({ supported: () => false }),
    });

    expect(screen.queryByRole("button", { name: /read replies aloud/i })).toBeNull();
  });

  it("reads a new reply on its own once that is switched on", async () => {
    server.use(
      http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))),
      http.post("http://localhost:3000/api/chat", () =>
        new HttpResponse("Sehr gut, Alex!", { status: 200 }),
      ),
    );

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ playback });

    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    await user.type(box(), "Mir geht es gut.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(playback.played).toHaveLength(1));
  });

  it("does not read the same reply twice", async () => {
    // The effect runs on every render; the message id is what stops it, not
    // the dependency list.
    server.use(
      http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))),
      http.post("http://localhost:3000/api/chat", () =>
        new HttpResponse("Sehr gut, Alex!", { status: 200 }),
      ),
    );

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ playback });

    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    await user.type(box(), "Mir geht es gut.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(playback.played).toHaveLength(1));

    playback.finish();
    await user.type(box(), "Noch etwas");

    expect(playback.played).toHaveLength(1);
  });

  it("does not read an older reply again when a later turn is taken back", async () => {
    // The rollback of a refused message makes the previous reply the newest
    // one again. Without a guard on which reply has been read, the tutor
    // repeats itself every time a turn fails.
    server.use(
      http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))),
      http.post("http://localhost:3000/api/chat", () =>
        new HttpResponse("Sehr gut, Alex!", { status: 200 }),
      ),
    );

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ playback });

    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    await user.type(box(), "Mir geht es gut.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(playback.played).toHaveLength(1));
    playback.finish();

    // A second turn the server refuses. Its message is rolled back out of the
    // list, which puts the first reply back on the end of it.
    server.use(
      http.post("http://localhost:3000/api/chat", () =>
        HttpResponse.json({ message: "Too many messages." }, { status: 429 }),
      ),
    );
    await user.type(box(), "Und du?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(playback.played).toHaveLength(1);
  });

  it("does not read an old reply out while a new one is still arriving", async () => {
    // Same shape, but caught mid-stream: the previous reply is the newest
    // message in the list while the next one is still only text on its way.
    const encoder = new TextEncoder();
    const reply = {
      opened: false,
      push: (_text: string) => {},
      close: () => {},
    };

    server.use(
      http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))),
      http.post("http://localhost:3000/api/chat", () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            reply.push = (text) => controller.enqueue(encoder.encode(text));
            reply.close = () => controller.close();
            reply.opened = true;
          },
        });
        return new HttpResponse(body, { status: 200 });
      }),
    );

    const playback = fakePlayback();
    const user = userEvent.setup();
    const { container } = renderConversation({
      messages: [REPLY],
      playback,
    });

    await user.type(box(), "Mir geht es gut.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(reply.opened).toBe(true));

    // Switched on mid-turn, with a half-arrived reply on screen.
    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    reply.push("Sehr ");
    await waitFor(() => {
      expect(container.querySelector("[data-streaming='true']")).toBeInTheDocument();
    });

    // The old reply must not be read over the top of the arriving one.
    expect(playback.played).toHaveLength(0);

    reply.push("gut!");
    reply.close();
    await waitFor(() => expect(playback.played).toHaveLength(1));
  });

  it("leaves replies unread until it is switched on", async () => {
    server.use(
      http.post(SPEAK, () => new HttpResponse(new Blob(["mp3"]))),
      http.post("http://localhost:3000/api/chat", () =>
        new HttpResponse("Sehr gut, Alex!", { status: 200 }),
      ),
    );

    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ playback });

    await user.type(box(), "Mir geht es gut.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Sehr gut, Alex!")).toBeInTheDocument());

    expect(playback.played).toHaveLength(0);
  });
});

describe("the learner's chosen voice", () => {
  it("asks the server for it", async () => {
    let body: unknown;
    server.use(
      http.post(SPEAK, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(new Blob(["mp3"]));
      }),
    );

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A2"
        voiceGender="female"
        capture={fakeCapture()}
        playback={fakePlayback()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() =>
      expect(body).toMatchObject({ voice: "female" }),
    );
  });

  it("hands it to the browser voice when the server has none", async () => {
    server.use(http.post(SPEAK, () => new HttpResponse("", { status: 503 })));
    const spokenWith: unknown[] = [];
    const browserVoice = {
      supported: () => true,
      speak: async (_text: string, _rate: number, gender?: string) => {
        spokenWith.push(gender);
      },
      stop: () => {},
    };

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A2"
        voiceGender="female"
        capture={fakeCapture()}
        playback={fakePlayback({ supported: () => false })}
        voice={browserVoice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(spokenWith).toEqual(["female"]));
  });
});

describe("one voice at a time", () => {
  const SECOND: ChatMessage = {
    id: "reply-2",
    role: "assistant",
    content: "Was machst du heute?",
  };

  function stubSpeak() {
    server.use(
      http.post(SPEAK, () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(8), {
          headers: { "content-type": "audio/mpeg" },
        }),
      ),
    );
  }

  it("stops the first reply the moment the second starts", async () => {
    // Two tutors talking over each other is worse than silence, and the two
    // channels cannot hear each other — the component has to be the referee.
    stubSpeak();
    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ messages: [REPLY, SECOND], playback });

    const readButtons = screen.getAllByRole("button", { name: /read this reply aloud/i });
    await user.click(readButtons[0]!);
    await waitFor(() => expect(playback.played).toHaveLength(1));

    await user.click(screen.getAllByRole("button", { name: /read this reply aloud/i })[0]!);
    await waitFor(() => expect(playback.played).toHaveLength(2));
  });

  it("keeps the second reply's button pressed when the first one settles", async () => {
    // The first read's finally must not clear the second read's state: the
    // highlight going dark mid-playback makes the next click restart the
    // audio instead of stopping it.
    stubSpeak();
    const playback = fakePlayback();
    const user = userEvent.setup();
    renderConversation({ messages: [REPLY, SECOND], playback });

    await user.click(
      screen.getAllByRole("button", { name: /read this reply aloud/i })[0]!,
    );
    await waitFor(() => expect(playback.played).toHaveLength(1));

    // Starting the second stops the first, which settles the first play
    // promise — exactly the moment the stale clear used to fire.
    await user.click(
      screen.getAllByRole("button", { name: /read this reply aloud/i })[0]!,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /stop reading this reply/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/could not be read aloud/i)).not.toBeInTheDocument();
  });
});

describe("the chosen voice engine", () => {
  // The store falls back to "ai" when storage is unusable, so these tests
  // need a storage that actually works — the environment's own localStorage
  // global cannot be relied on to have methods at all.
  function stubStorage(): Map<string, string> {
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
    return store;
  }

  function countSpeakCalls(): () => number {
    let calls = 0;
    server.use(
      http.post(SPEAK, () => {
        calls += 1;
        return new HttpResponse(new Blob(["mp3"]));
      }),
    );
    return () => calls;
  }

  it("never asks the server when the device's voice is chosen", async () => {
    stubStorage();
    window.localStorage.setItem("deutsch-partner.voice-engine", "browser");
    const speakCalls = countSpeakCalls();

    const voice = fakeVoice();
    const playback = fakePlayback();
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A1"
        capture={fakeCapture()}
        playback={playback}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(voice.spoken[0]).toEqual({ text: "Wie geht es dir?", rate: SPEECH_RATES.A1 });
    expect(speakCalls()).toBe(0);
    expect(playback.played).toHaveLength(0);
  });

  it("keeps preferring the model when the choice is the AI voice", async () => {
    stubStorage();
    window.localStorage.setItem("deutsch-partner.voice-engine", "ai");
    countSpeakCalls();

    const voice = fakeVoice();
    const playback = fakePlayback();
    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        cefr="A1"
        capture={fakeCapture()}
        playback={playback}
        voice={voice}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(playback.played).toHaveLength(1));
    expect(voice.spoken).toHaveLength(0);
  });

  it("says so when the chosen device voice fails, without asking the model behind the learner's back", async () => {
    // They said "never the server". A silent fallback to the AI voice would
    // be the setting lying about what it does.
    stubStorage();
    window.localStorage.setItem("deutsch-partner.voice-engine", "browser");
    const speakCalls = countSpeakCalls();

    const user = userEvent.setup();
    render(
      <Conversation
        threadId="1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b"
        initialMessages={[REPLY]}
        miniLevel={1}
        capture={fakeCapture()}
        playback={fakePlayback()}
        voice={fakeVoice({
          speak: async () => {
            throw new Error("no voice here");
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not be read aloud/i)).toBeInTheDocument();
    });
    expect(speakCalls()).toBe(0);
  });
});

describe("the advance button after a refusal", () => {
  it("does not put the synthetic request into the draft box", async () => {
    // The move is written before generation, so it can outlive a failed
    // reply. Restoring "Weiter bitte!" into the box would turn "retry" into
    // "advance a second level".
    server.use(
      http.post("http://localhost:3000/api/chat", () =>
        HttpResponse.json({ message: "Your tutor is unavailable." }, { status: 503 }),
      ),
    );

    const user = userEvent.setup();
    renderConversation();

    await user.click(screen.getByRole("button", { name: /next mini-level/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i),
    );
    expect(box()).toHaveValue("");
  });
});
