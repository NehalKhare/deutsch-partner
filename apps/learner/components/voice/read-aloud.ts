"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  createBrowserPlayback,
  createBrowserSpeech,
  type SpeechPlayback,
  type SpeechVoice,
} from "@/components/voice/speech";
import type { CEFRLevel } from "@dp/domain/cefr";
import { SPEECH_RATES, speechRateFor } from "@dp/domain/speech";
import { toPlainText } from "@dp/ui/markdown/parse";
import { planRefusalFrom, type PlanRefusal } from "@/lib/billing/refusal";
import {
  useDevicePreference,
  voiceEngineStore,
  voicePlanNoteStore,
} from "@/lib/settings/device";

/**
 * Reading a line of German aloud, wherever it was said.
 *
 * The chat and the trainer both want this and neither should own it: the
 * fallback chain is subtle enough that two copies would drift, and the copy
 * that drifted would be the one that quietly stopped falling back.
 *
 * The chain is speech model first, device voice second. The model sounds like
 * a person; the browser's own voice needs no key, costs nothing and ships on
 * every desktop, which makes it a real fallback rather than a consolation. A
 * learner who chose the device voice on the settings page skips the model
 * entirely — that choice lives per device, because how good the built-in
 * speech is depends entirely on the machine.
 *
 * Failure is quiet on purpose. A learner who cannot hear the line can still
 * read it, and a red banner over a working conversation because the audio
 * would not play is the worse outcome.
 *
 * The ports arrive as arguments rather than being reached for, because jsdom
 * has neither an Audio element nor a speech synthesiser: a hook that called
 * them directly could not be tested at all.
 *
 * The AI voice is a paid feature with a daily allowance; the device's voice
 * is neither (billing-and-plans-spec.md S2, S4). When the server declines for
 * the plan's sake the line is read by the device as for any other refusal,
 * the reason is kept so the page can say it once, and the model is not asked
 * again until the refusal says it would answer: never, for a plan without it;
 * when the window reopens, for spent voice lines. A plan the server could not
 * read is no answer at all, so that line falls back and the next one asks.
 */

/** What a device can do does not change while the page is open. */
const NEVER_CHANGES = () => () => {};

/** Anything with words and an identity: a chat reply, a trainer's answer. */
export interface SpokenLine {
  readonly id: string;
  readonly content: string;
}

export interface ReadAloudOptions {
  /** Decides how fast the tutor speaks. A1 is read more slowly than B1. */
  readonly cefr: CEFRLevel;
  /** The learner's chosen voice, from settings. Steers both speech paths. */
  readonly voiceGender: "male" | "female";
  readonly playback?: SpeechPlayback;
  /** The browser's own voice, used when the server has none configured. */
  readonly voice?: SpeechVoice;
  /**
   * Where the lines are read. The Trainer's AI voice is a feature of its own
   * (Premium's); the conversation's is the default and is not named.
   */
  readonly surface?: "chat" | "trainer";
}

export interface ReadAloud {
  /** Whether anything on this device can speak, before a button offers to. */
  readonly canSpeak: boolean;
  /** Which line is being read, so the caller can light up its control. */
  readonly speakingId: string | null;
  /** Said quietly beside the control that caused it, never as an error. */
  readonly notice: string | null;
  /**
   * Why the device's voice is reading rather than the AI's, when the plan is
   * the reason — or null, including once the learner put the note away.
   */
  readonly planRefusal: PlanRefusal | null;
  /** Puts the plan note away, on this device, for good. */
  readonly dismissPlanRefusal: () => void;
  /** Reads a line, or stops it if it is the one already being read. */
  readonly speak: (line: SpokenLine) => Promise<void>;
  readonly stop: () => void;
}

export function useReadAloud(options: ReadAloudOptions): ReadAloud {
  const { cefr, voiceGender, surface = "chat" } = options;

  // Which voice reads replies aloud: the speech model (device voice as its
  // fallback), or the device's own voice alone. Chosen on the settings page,
  // remembered per device, and read here so a change applies immediately.
  const voiceEngine = useDevicePreference(voiceEngineStore);
  const planNote = useDevicePreference(voicePlanNoteStore);

  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planRefusal, setPlanRefusal] = useState<PlanRefusal | null>(null);
  // Until when asking the model is pointless: forever for a plan without the
  // AI voice, until the window reopens for spent lines. A ref, because it
  // changes nothing on screen — the note above is what the learner sees.
  const modelHeldUntil = useRef(0);

  // Constructed once, and lazily: reaching for an Audio element or a speech
  // synthesiser at module load would break every environment without one,
  // including the server render of whatever component called this.
  const [player] = useState(() => options.playback ?? createBrowserPlayback());
  const [browserVoice] = useState(() => options.voice ?? createBrowserSpeech());

  /**
   * Whether this device can speak at all.
   *
   * Read through useSyncExternalStore for the same reason the device
   * preferences are: the server has no Audio element and no synthesiser to
   * ask, so it says no, and the client is allowed to disagree without a
   * hydration error. Either channel is enough to offer the button — a browser
   * that cannot play a downloaded clip may still have a voice of its own.
   */
  const canSpeak = useSyncExternalStore(
    NEVER_CHANGES,
    () => player.supported() || browserVoice.supported(),
    () => false,
  );

  useEffect(() => {
    return () => {
      player.stop();
      browserVoice.stop();
    };
  }, [player, browserVoice]);

  /**
   * Which read-aloud is current. Starting a new one, or stopping, bumps it —
   * and a superseded read checks it before touching shared state, so line A's
   * cancellation can neither clear line B's highlight nor raise a "could not
   * be read" notice about audio nobody wanted any more.
   */
  const session = useRef(0);

  const silence = () => {
    session.current += 1;
    player.stop();
    browserVoice.stop();
    setSpeakingId(null);
  };

  async function speak(line: SpokenLine) {
    // The same button again means stop. One voice at a time, across both
    // channels: the two ports cannot hear each other, and two tutors talking
    // at once is worse than silence.
    if (speakingId === line.id) {
      silence();
      return;
    }

    const current = ++session.current;
    player.stop();
    browserVoice.stop();
    setSpeakingId(line.id);

    // The words without the notation. Emphasis and list markers are for the
    // eye; a voice handed "**das Buch**" either says the asterisks or trips
    // over them, and neither is the sentence the learner asked to hear.
    const spoken = toPlainText(line.content);

    const speakWithDevice = () =>
      browserVoice.speak(
        spoken,
        speechRateFor(cefr as keyof typeof SPEECH_RATES),
        voiceGender,
      );

    try {
      if (voiceEngine === "browser") {
        // The learner chose the device's own voice, so the model is never
        // asked: instant, free, and exactly as good as this device's speech.
        await speakWithDevice();
      } else if (Date.now() < modelHeldUntil.current) {
        // The server already said the plan will not speak this; asking again
        // would only be a round trip before the same fallback.
        await speakWithDevice();
      } else {
        try {
          const response = await fetch("/api/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: spoken,
              cefr,
              voice: voiceGender,
              ...(surface === "chat" ? {} : { surface }),
            }),
          });
          if (!response.ok) {
            const refusal = planRefusalFrom(await response.json().catch(() => null));
            // A missing feature with no upgrade on offer is a plan the server
            // could not read: that learner may already have the voice. So
            // this line falls back silently, as it did before plans, and the
            // next one asks again — one failed read is not a verdict.
            const unread = refusal?.error === "plan_required" && !refusal.upgrade;
            if (refusal && !unread) {
              modelHeldUntil.current = refusal.resetAt
                ? Date.parse(refusal.resetAt)
                : Number.POSITIVE_INFINITY;
              setPlanRefusal(refusal);
            }
            throw new Error("the server has no voice");
          }
          await player.play(await response.blob());
        } catch {
          // Deliberately cancelled reads do not fall back and do not complain.
          if (current !== session.current) return;
          await speakWithDevice();
        }
      }
    } catch {
      if (current !== session.current) return;
      setNotice("That reply could not be read aloud.");
    } finally {
      if (current === session.current) setSpeakingId(null);
    }
  }

  function dismissPlanRefusal() {
    voicePlanNoteStore.write("dismissed");
    setPlanRefusal(null);
  }

  return {
    canSpeak,
    speakingId,
    notice,
    planRefusal: planNote === "dismissed" ? null : planRefusal,
    dismissPlanRefusal,
    speak,
    stop: silence,
  };
}
