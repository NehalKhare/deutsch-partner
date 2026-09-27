import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { TrainerSession } from "@/components/trainer/session";
import type { SpeechPlayback, SpeechVoice } from "@/components/voice/speech";
import { SPEECH_RATES } from "@dp/domain/speech";
import { server } from "@dp/test-support/msw";

/**
 * Hearing the trainer.
 *
 * The same ports the chat is tested through, for the same reason: jsdom has
 * no audio element and no synthesiser. What is asserted is the behaviour a
 * learner would notice — the model's voice first, the device's own voice when
 * the server has none, one voice at a time, and a failure that stays quiet
 * enough to keep practising through.
 */

const TRAINER_ENDPOINT = "http://localhost:3000/api/trainer";
const SPEAK = "http://localhost:3000/api/speak";

const REPLY = {
  reply: 'Was heißt "der Bahnhof"?',
  steps: [],
  sources: [],
  agenda: [{ kind: "recall", subject: "der Bahnhof" }],
  covered: [],
  complete: false,
  costEur: 0.002,
};

function fakePlayback(over: Partial<SpeechPlayback> = {}) {
  const played: Blob[] = [];
  let finish: (() => void) | null = null;
  const playback: SpeechPlayback & { played: Blob[]; finish: () => void } = {
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

function fakeVoice(over: Partial<SpeechVoice> = {}) {
  const spoken: Array<{ text: string; rate: number; gender?: string }> = [];
  const voice: SpeechVoice & { spoken: typeof spoken } = {
    spoken,
    supported: () => true,
    async speak(text: string, rate: number, gender?: "male" | "female") {
      spoken.push({ text, rate, gender });
    },
    stop() {},
    ...over,
  };
  return voice;
}

function renderSession(
  options: {
    playback?: SpeechPlayback;
    voice?: SpeechVoice;
    cefr?: "A1" | "A2" | "B1";
    voiceGender?: "male" | "female";
    outputPreference?: "text" | "voice";
  } = {},
) {
  return render(
    <TrainerSession
      cefr={options.cefr ?? "A2"}
      voiceGender={options.voiceGender ?? "male"}
      outputPreference={options.outputPreference}
      playback={options.playback}
      voice={options.voice}
    />,
  );
}

async function sendAndWaitForReply(text = "Lass uns üben!") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your message to the trainer/i), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(REPLY.reply);
  return user;
}

describe("a plan without the AI voice", () => {
  it("reads the reply in the device's voice and says why, once, quietly", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => (key === "deutsch-partner.voice-plan-note" ? "shown" : null),
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });
    const voice = fakeVoice();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () =>
        HttpResponse.json(
          { error: "plan_required", message: "The AI voice comes with a paid plan.", resetAt: null, upgrade: true },
          { status: 402 },
        ),
      ),
    );
    renderSession({ playback: fakePlayback(), voice });

    const user = await sendAndWaitForReply();
    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(screen.getByText(/your device's voice/i)).toBeInTheDocument();
    // The Trainer's AI voice is Premium's, whatever the conversation's is.
    expect(screen.getByText(/in the Trainer comes with Premium/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for the Trainer's line as the Trainer's", async () => {
    let body: unknown = null;
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, async ({ request }) => {
        body = await request.json();
        return HttpResponse.arrayBuffer(new ArrayBuffer(8), { headers: { "content-type": "audio/mpeg" } });
      }),
    );
    renderSession({ playback: fakePlayback() });

    const user = await sendAndWaitForReply();
    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(body).toMatchObject({ text: REPLY.reply, surface: "trainer" }));
  });
});

describe("reading the trainer aloud", () => {
  it("offers a speaker on each reply and plays the model's voice", async () => {
    const playback = fakePlayback();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(8), {
          headers: { "content-type": "audio/mpeg" },
        }),
      ),
    );
    renderSession({ playback });

    const user = await sendAndWaitForReply();
    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(playback.played).toHaveLength(1));
    // While it is playing, the same control offers to stop it.
    expect(
      screen.getByRole("button", { name: /stop reading this reply/i }),
    ).toBeInTheDocument();

    playback.finish();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /read this reply aloud/i }),
      ).toBeInTheDocument();
    });
  });

  it("falls back to this device's voice when the server has none", async () => {
    const voice = fakeVoice();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () => HttpResponse.json({ error: "unavailable" }, { status: 503 })),
    );
    renderSession({ playback: fakePlayback(), voice, cefr: "A1" });

    const user = await sendAndWaitForReply();
    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    // Read at the learner's pace, in the learner's voice.
    expect(voice.spoken[0]).toMatchObject({
      text: REPLY.reply,
      rate: SPEECH_RATES.A1,
      gender: "male",
    });
  });

  it("says so quietly when nothing can read the reply, and keeps the session", async () => {
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () => HttpResponse.json({ error: "unavailable" }, { status: 503 })),
    );
    renderSession({
      playback: fakePlayback(),
      voice: fakeVoice({
        async speak() {
          throw new Error("no voices installed");
        },
      }),
    });

    const user = await sendAndWaitForReply();
    await user.click(screen.getByRole("button", { name: /read this reply aloud/i }));

    expect(await screen.findByText(/could not be read aloud/i)).toBeInTheDocument();
    // A quiet status, never the alert that means the turn did not happen.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText(/your message to the trainer/i)).toBeEnabled();
  });

  it("reads every new reply once the learner asks it to", async () => {
    const voice = fakeVoice();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () => HttpResponse.json({ error: "unavailable" }, { status: 503 })),
    );
    renderSession({ playback: fakePlayback(), voice });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    await sendAndWaitForReply();

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(voice.spoken[0]?.text).toBe(REPLY.reply);
  });

  it("reads a reply once, not once per render", async () => {
    const voice = fakeVoice();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () => HttpResponse.json({ error: "unavailable" }, { status: 503 })),
    );
    renderSession({ playback: fakePlayback(), voice });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /read replies aloud/i }));
    const typed = await sendAndWaitForReply();
    await waitFor(() => expect(voice.spoken).toHaveLength(1));

    // A second turn is a second reading, and the first is not repeated.
    await typed.type(screen.getByLabelText(/your message to the trainer/i), "der");
    await typed.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(voice.spoken).toHaveLength(2));
  });

  it("reads aloud from the first reply when the learner chose spoken replies", async () => {
    // The setting said "read aloud". Making them press a toggle every time is
    // the setting not meaning anything.
    const voice = fakeVoice();
    server.use(
      http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)),
      http.post(SPEAK, () => HttpResponse.json({ error: "unavailable" }, { status: 503 })),
    );
    renderSession({
      playback: fakePlayback(),
      voice,
      outputPreference: "voice",
    });

    await sendAndWaitForReply();

    await waitFor(() => expect(voice.spoken).toHaveLength(1));
    expect(
      screen.getByRole("button", { name: /read replies aloud/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("stays quiet when the learner asked for replies as text", async () => {
    const voice = fakeVoice();
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    renderSession({
      playback: fakePlayback(),
      voice,
      outputPreference: "text",
    });

    await sendAndWaitForReply();

    expect(voice.spoken).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /read replies aloud/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("reads nothing when the preference says voice and the device has none", async () => {
    // A preference switched on for a device that cannot speak must not turn
    // into one "could not be read aloud" per reply.
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    renderSession({
      playback: fakePlayback({ supported: () => false }),
      voice: fakeVoice({ supported: () => false }),
      outputPreference: "voice",
    });

    await sendAndWaitForReply();

    expect(screen.queryByText(/could not be read aloud/i)).toBeNull();
  });

  it("offers nothing to press on a device that cannot speak", async () => {
    server.use(http.post(TRAINER_ENDPOINT, () => HttpResponse.json(REPLY)));
    renderSession({
      playback: fakePlayback({ supported: () => false }),
      voice: fakeVoice({ supported: () => false }),
    });

    await sendAndWaitForReply();

    expect(screen.queryByRole("button", { name: /read replies aloud/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /read this reply aloud/i })).toBeNull();
  });
});
