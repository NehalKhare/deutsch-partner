"use client";

import { useEffect, useRef, useState } from "react";

import { Companion } from "@/components/companion/companion";
import {
  createBrowserCapture,
  createBrowserPlayback,
  createBrowserSpeech,
  type SpeechCapture,
  type SpeechPlayback,
  type SpeechVoice,
} from "@/components/chat/speech";
import { SPEECH_RATES, speechRateFor } from "@/lib/ai/voice/providers";
import { HISTORY_WINDOW } from "@/domain/conversation";
import { buttonPrimary, field, focusRing } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { companionActivityFor, companionStateFor } from "@/domain/companion";
import { TUTOR } from "@/domain/tutor";

/** Shown when a refusal arrives with nothing a learner could act on. */
const FALLBACK_ERROR = "Something went wrong. Please try again.";

/*
 * Drawn here rather than pulled from an icon set. Two shapes at one size is
 * not worth a dependency, and both are decorative: the button around each one
 * carries the name, so a screen reader never meets the drawing.
 */

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      {speaking ? (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      ) : (
        <path d="M15.5 9a4 4 0 0 1 0 6" />
      )}
    </svg>
  );
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * The conversation, streamed.
 *
 * The learner's own message appears immediately and the tutor's arrives a word
 * at a time, because waiting in silence for a whole German paragraph feels
 * broken even when it is fast.
 *
 * That is why none of this runs inside a transition. React 19 holds every
 * update made inside an async `startTransition` until the action settles, so
 * a streamed reply wrapped in one does not stream: the learner's own message,
 * every chunk of the answer and the companion's whole performance all land at
 * once, at the end. `sending` is therefore plain state, and each chunk is an
 * urgent update.
 *
 * Nothing here decides anything. It sends a thread id, a message and the
 * recent transcript, renders the bytes that come back, and shows a plain
 * sentence if the server refuses. Every rule about who may post and what it
 * costs lives on the server, where a learner cannot edit it.
 *
 * The transcript lives here and only here. Nothing a learner says in a
 * conversation is written to storage of any kind — not a database row, not
 * localStorage — so each turn carries its own recent history up to the
 * server, and closing the tab is genuinely the end of the conversation. What
 * survives is the level tally the server keeps about how the practice went.
 *
 * The companion is driven by what is actually happening rather than by a
 * timer: listening while the learner types or speaks, speaking while the
 * reply is arriving — or, once there is a voice, while it is being read out.
 *
 * Recording and playback arrive as ports rather than as MediaRecorder and
 * Audio, because jsdom has neither and a component that reaches for them
 * directly cannot be tested at all.
 *
 * Reading a reply aloud tries the speech model first and the browser's own
 * voice second. The model sounds like a person; the browser needs no key and
 * costs nothing, which makes it the difference between a tutor that can be
 * heard and one that could have been.
 */
export function Conversation({
  threadId,
  title,
  initialMessages = [],
  miniLevel,
  theme,
  cefr = "A1",
  voiceGender = "male",
  capture,
  playback,
  voice,
}: {
  threadId: string;
  /** The thread's name, shown beside the companion in the header. */
  title?: string;
  /** A seed for tests and demos. Production threads always start empty. */
  initialMessages?: readonly ChatMessage[];
  /** How far the learner has come, which is how large the companion is. */
  miniLevel: number;
  /** What the current mini-level is called, so "next" is not a leap in the dark. */
  theme?: string;
  /** The learner's chosen voice, from settings. Steers both speech paths. */
  voiceGender?: "male" | "female";
  /** Decides how fast the tutor speaks. A1 is read more slowly than B1. */
  cefr?: string;
  capture?: SpeechCapture;
  playback?: SpeechPlayback;
  /** The browser's own voice, used when the server has none configured. */
  voice?: SpeechVoice;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([...initialMessages]);
  // Where the learner stands right now. A turn that moves them — by asking,
  // by the button, or by earning it — says so in the response headers, and
  // this is what keeps the label and the companion honest without a reload.
  const [position, setPosition] = useState({ miniLevel, theme: theme ?? null });
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Counted rather than derived from the list's length, because a refused turn
  // takes its message back out again and a length-derived id would be reused.
  const nextId = useRef(0);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  // Constructed once, and lazily: reaching for MediaRecorder at module load
  // would break every environment that does not have one, including the
  // server render of this very component.
  const captureRef = useRef<SpeechCapture | null>(capture ?? null);
  const playbackRef = useRef<SpeechPlayback | null>(playback ?? null);
  const voiceRef = useRef<SpeechVoice | null>(voice ?? null);
  captureRef.current ??= createBrowserCapture();
  playbackRef.current ??= createBrowserPlayback();
  voiceRef.current ??= createBrowserSpeech();
  const recorder = captureRef.current;
  const player = playbackRef.current;
  const browserVoice = voiceRef.current;

  const [canRecord, setCanRecord] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  // Asked after mount: on the server there is no navigator to ask, and a mic
  // button rendered on the server and withdrawn on the client is a flicker.
  useEffect(() => {
    setCanRecord(recorder.supported());
    // Either way of being heard counts. A browser with no audio element but a
    // speech synthesiser can still read a reply out.
    setCanSpeak(player.supported() || browserVoice.supported());
  }, [recorder, player, browserVoice]);

  // The microphone must not stay open because somebody navigated away.
  useEffect(() => {
    return () => {
      recorder.cancel();
      player.stop();
      browserVoice.stop();
    };
  }, [recorder, player, browserVoice]);

  /**
   * Sends the turn and streams the reply back.
   *
   * Throws on every failure — a refusal, an unreadable body, a dropped
   * connection — so there is one rollback path rather than one per way of
   * failing.
   */
  async function dispatch(
    message: string,
    history: readonly Pick<ChatMessage, "role" | "content">[],
  ) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, message, history }),
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      throw new Error(body?.message ?? FALLBACK_ERROR);
    }

    const movedTo = response.headers.get("x-mini-level");
    const movedTheme = response.headers.get("x-mini-level-theme");
    if (movedTo && Number.isFinite(Number(movedTo))) {
      setPosition({
        miniLevel: Number(movedTo),
        theme: movedTheme ? decodeURIComponent(movedTheme) : null,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      setStreaming(text);
    }

    setStreaming("");
    setMessages((previous) => [
      ...previous,
      { id: `reply-${nextId.current++}`, role: "assistant", content: text },
    ]);
  }

  /**
   * Owns the optimistic message, the sending flag and the failure path.
   *
   * The learner's words go up straight away, and come back down if the turn
   * was refused. Leaving them there would be the worst of both: a bubble that
   * looks delivered, that the server never saved, that vanishes on the next
   * reload — and that appears twice if they retype it and try again.
   */
  async function send(
    message: string,
    options: { readonly restoreOnFailure?: boolean } = {},
  ) {
    const { restoreOnFailure = true } = options;
    const id = `local-${nextId.current++}`;

    // Snapshotted before the optimistic append: the history is what was said
    // before this message, which travels separately.
    const history = messages
      .slice(-HISTORY_WINDOW)
      .map(({ role, content }) => ({ role, content }));

    setError(null);
    setSending(true);
    setMessages((previous) => [
      ...previous,
      { id, role: "user", content: message },
    ]);

    try {
      await dispatch(message, history);
    } catch (failure) {
      setStreaming("");
      setMessages((previous) => previous.filter((entry) => entry.id !== id));
      // Put their sentence back where they can send it again — unless they
      // have already started typing something else into the box. Never for
      // the button's synthetic "Weiter bitte!": the move can outlive a failed
      // reply (it is written before generation), and a restored draft would
      // turn "retry my sentence" into "advance another level".
      if (restoreOnFailure) {
        setDraft((current) => (current.length === 0 ? message : current));
      }
      setError(failure instanceof Error ? failure.message : FALLBACK_ERROR);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  /**
   * Which read-aloud is current. Starting a new one, or stopping, bumps it —
   * and a superseded read checks it before touching shared state, so reply
   * A's cancellation can neither clear reply B's highlight nor raise a
   * "could not be read" notice about audio nobody wanted any more.
   */
  const speakSession = useRef(0);

  /**
   * Speaks a line aloud and reports it as the companion speaking.
   *
   * One voice at a time, across both channels: starting B stops A whether A
   * was the model's audio or the browser's synthesiser, because the two ports
   * cannot hear each other and two tutors talking at once is worse than
   * silence.
   *
   * Failure is quiet on purpose: a learner who cannot hear the reply can still
   * read it, and a red banner over a working conversation because the audio
   * did not play is a worse outcome than silence.
   */
  async function speak(message: ChatMessage) {
    if (speakingId === message.id) {
      speakSession.current += 1;
      player.stop();
      browserVoice.stop();
      setSpeakingId(null);
      return;
    }

    const session = ++speakSession.current;
    player.stop();
    browserVoice.stop();
    setSpeakingId(message.id);
    try {
      // The speech model first, because it is the one that sounds like a
      // person. The browser's own voice is the fallback, and it is a real one:
      // it needs no key, costs nothing, and every desktop ships German.
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message.content, cefr, voice: voiceGender }),
      });
      if (!response.ok) throw new Error("the server has no voice");
      await player.play(await response.blob());
    } catch {
      // Deliberately cancelled reads do not fall back and do not complain.
      if (session !== speakSession.current) return;
      try {
        await browserVoice.speak(
          message.content,
          speechRateFor(cefr as keyof typeof SPEECH_RATES),
          voiceGender,
        );
      } catch {
        if (session !== speakSession.current) return;
        setVoiceNotice("That reply could not be read aloud.");
      }
    } finally {
      if (session === speakSession.current) setSpeakingId(null);
    }
  }

  // Reads the newest reply when the learner has asked for that. Keyed on the
  // message id so a re-render cannot make it read the same line twice.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (!readAloud || streaming.length > 0) return;

    const newest = messages[messages.length - 1];
    if (!newest || newest.role !== "assistant") return;
    if (lastSpoken.current === newest.id) return;

    lastSpoken.current = newest.id;
    void speak(newest);
    // speak is redefined every render; the id guard above is what makes this
    // run once, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, readAloud, streaming]);

  /** Records, transcribes, and puts the words in the box — never sends them. */
  async function toggleRecording() {
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const clip = await recorder.stop();
        const form = new FormData();
        form.set("audio", clip.audio);
        form.set("durationMs", String(clip.durationMs));

        const response = await fetch("/api/transcribe", { method: "POST", body: form });
        const body = (await response.json().catch(() => null)) as
          | { text?: string; message?: string }
          | null;

        if (!response.ok || !body?.text) {
          throw new Error(body?.message ?? "We could not make that out.");
        }

        // Into the box, not into the thread. A learner has to see what was
        // heard before it becomes something they said — a misheard word is
        // the entire thing they are here to notice.
        setDraft((current) =>
          current.length === 0 ? body.text! : `${current} ${body.text}`,
        );
        inputRef.current?.focus();
      } catch (failure) {
        setVoiceNotice(
          failure instanceof Error ? failure.message : "We could not make that out.",
        );
      } finally {
        setTranscribing(false);
      }
      return;
    }

    setVoiceNotice(null);
    try {
      await recorder.start();
      setRecording(true);
    } catch {
      // Overwhelmingly this is the learner declining the permission prompt.
      setVoiceNotice("We could not reach your microphone.");
    }
  }

  // What the companion is doing is decided in the domain, not here: this
  // component only knows which of the things is currently true. Reading a
  // reply aloud is the companion speaking as much as streaming text is, and
  // talking into the microphone is composing a message.
  const activity = companionActivityFor({
    replying: streaming.length > 0 || speakingId !== null,
    sending: sending || transcribing,
    composing: draft.trim().length > 0 || recording,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* The tutor sits top left, where a face belongs in a conversation. The
          blob, the title and the position label are one unit: what is looking
          at you, what this room is called, and where you are standing. All of
          it is live — a move mid-conversation updates the label and grows the
          blob without a reload. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-haze/60 pb-4">
        <Companion
          state={companionStateFor({ miniLevel: position.miniLevel, activity })}
          decorative
          className="[--companion-size:4.25rem]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? (
            <h1
              lang="de"
              className="truncate font-display text-xl font-semibold tracking-tight"
            >
              {title}
            </h1>
          ) : null}
          <p className="font-display text-xs uppercase tracking-wider text-chalk/60">
            Mini-level {position.miniLevel}
            {position.theme ? (
              <>
                {" · "}
                <span lang="de" className="normal-case tracking-normal text-chalk/60">
                  {position.theme}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* A visible handle on the same door "weiter" opens. It goes through
              the ordinary send path on purpose: the server owns the move, and
              the tutor answers from the new level in the same breath. */}
          <button
            type="button"
            onClick={() => void send("Weiter bitte!", { restoreOnFailure: false })}
            disabled={sending}
            aria-label="Move on to the next mini-level"
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
              "uppercase tracking-wider text-chalk/70 transition-colors hover:text-apricot",
              "disabled:pointer-events-none disabled:opacity-50",
              focusRing,
            )}
          >
            Next mini-level →
          </button>

          {canSpeak ? (
            <button
              type="button"
              onClick={() => setReadAloud((on) => !on)}
              aria-pressed={readAloud}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs",
                "uppercase tracking-wider transition-colors",
                readAloud ? "text-apricot" : "text-chalk/70 hover:text-chalk",
                focusRing,
              )}
            >
              <SpeakerIcon speaking={readAloud} />
              Read replies aloud
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* An empty thread with nothing but a text box reads as broken. The
            invitation is in German and short enough to answer. */}
        {messages.length === 0 && streaming.length === 0 ? (
          <div className="m-auto flex max-w-xs flex-col gap-2 text-center">
            <p className="text-chalk/45">
              {TUTOR.name} is waiting. Say anything —{" "}
              <span lang="de" className="text-chalk/70">
                Hallo!
              </span>{" "}
              is enough to start.
            </p>
            <p className="text-xs text-chalk/55">
              Nothing you say here is stored. What you learn is.
            </p>
          </div>
        ) : null}

        {/* Polite, so a finished reply is read once when it lands. The
            in-progress bubble below opts out: before the stream was fixed this
            region changed once per turn, and now it changes once per chunk,
            which is a screen reader reading the same half-sentence twenty
            times. */}
        <ol className="mt-auto flex flex-col gap-3" aria-live="polite">
          {messages.map((message) =>
            message.role === "user" ? (
              <li
                key={message.id}
                data-role="user"
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-apricot px-4 py-2.5 leading-relaxed text-ink"
              >
                {message.content}
              </li>
            ) : (
              <li
                key={message.id}
                data-role="assistant"
                className="flex max-w-[85%] items-end gap-1.5 self-start"
              >
                <span
                  lang="de"
                  className="rounded-2xl rounded-bl-md border border-haze/70 bg-dusk px-4 py-2.5 leading-relaxed text-chalk"
                >
                  {message.content}
                </span>
                <button
                  type="button"
                  onClick={() => void speak(message)}
                  aria-label={
                    speakingId === message.id
                      ? "Stop reading this reply"
                      : "Read this reply aloud"
                  }
                  aria-pressed={speakingId === message.id}
                  className={cn(
                    "shrink-0 rounded-full p-1.5 text-chalk/50 transition-colors hover:text-apricot",
                    speakingId === message.id && "text-apricot",
                    focusRing,
                  )}
                >
                  <SpeakerIcon speaking={speakingId === message.id} />
                </button>
              </li>
            ),
          )}
          {streaming ? (
            <li
              data-role="assistant"
              data-streaming="true"
              aria-live="off"
              lang="de"
              className="max-w-[85%] self-start rounded-2xl rounded-bl-md border border-apricot/40 bg-dusk px-4 py-2.5 leading-relaxed text-chalk"
            >
              {streaming}
            </li>
          ) : null}
        </ol>
      </div>

      {/* What the companion is doing, for somebody who cannot see it. One
          sentence for the whole wait rather than one per state: the reply
          itself is announced when it arrives, and this only has to say that
          one is coming. */}
      <p role="status" className="sr-only">
        {sending || streaming ? `${TUTOR.name} is replying.` : ""}
      </p>

      {/* Voice is an addition to the conversation, not the conversation. Its
          failures are said quietly, beside the control that caused them, and
          never as the red banner that means "your turn did not happen". */}
      {voiceNotice ? (
        <p role="status" className="px-1 text-xs text-chalk/55">
          {voiceNotice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ember/40 bg-ember/10 px-4 py-2.5 text-sm text-ember"
        >
          {error}
        </p>
      ) : null}

      <form
        className="sticky bottom-0 flex items-center gap-3 border-t border-haze/60 bg-ink/95 py-4 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message.length === 0 || sending) return;

          setDraft("");
          void send(message);
        }}
      >
        {canRecord ? (
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={sending || transcribing}
            aria-label={recording ? "Stop recording" : "Speak your message"}
            aria-pressed={recording}
            className={cn(
              "shrink-0 rounded-full border p-2.5 transition-colors",
              recording
                ? "animate-pulse border-ember bg-ember/20 text-ember"
                : "border-haze text-chalk/60 hover:border-apricot/60 hover:text-apricot",
              "disabled:pointer-events-none disabled:opacity-50",
              focusRing,
            )}
          >
            <MicIcon />
          </button>
        ) : null}

        <input
          ref={inputRef}
          name="message"
          aria-label="Your message in German"
          placeholder="Schreib auf Deutsch…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          lang="de"
          className={cn(field, "flex-1")}
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className={cn(buttonPrimary, "px-5 py-2.5")}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
