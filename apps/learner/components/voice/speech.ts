"use client";

/**
 * The two things a browser has to do for a spoken conversation: record the
 * learner, and play the tutor.
 *
 * Both are behind an interface for the same reason the providers on the server
 * are: what the conversation needs is "give me what they said" and "say this",
 * and neither MediaRecorder nor HTMLAudioElement should appear above that
 * line. It also means the component can be driven in a test, which matters
 * more here than usual — jsdom has neither of these APIs, so a component that
 * reached for them directly could not be tested at all.
 */

export interface Recording {
  readonly audio: Blob;
  /** What the browser observed, not what the audio decodes to. */
  readonly durationMs: number;
}

export interface SpeechCapture {
  /** Whether this browser can record at all, before a button offers to. */
  supported(): boolean;
  start(): Promise<void>;
  /** Resolves with what was recorded, and releases the microphone. */
  stop(): Promise<Recording>;
  /** Abandons a recording and releases the microphone. Safe to call twice. */
  cancel(): void;
}

export interface SpeechPlayback {
  supported(): boolean;
  /** Resolves when the audio has finished, or rejects if it cannot play. */
  play(audio: Blob): Promise<void>;
  /** Stops whatever is playing. Safe to call when nothing is. */
  stop(): void;
}

/**
 * A voice the browser already has.
 *
 * The Web Speech API needs no key, no route and no money, and every desktop
 * browser ships German voices. It is not as good as a real speech model — the
 * prosody is flatter and the pace less natural — so it is the fallback rather
 * than the first choice. But a tutor that can be heard is worth far more than
 * a tutor that could be heard beautifully if somebody configured a key.
 */
export interface SpeechVoice {
  supported(): boolean;
  /** Speaks German at the given pace, and resolves when it has finished. */
  speak(text: string, rate: number, gender?: "male" | "female"): Promise<void>;
  stop(): void;
}

/** How long to wait for a platform to report its voices before giving up. */
const VOICE_LOAD_MS = 500;

/**
 * German voices this tutor would rather be.
 *
 * The Web Speech API exposes no gender at all — a voice has a name, a language
 * and nothing else — so the only way to ask for a man is to know which of them
 * are men. This is the list per platform: macOS ships Markus and Yannick,
 * Windows ships Stefan and Conrad, and several Linux stacks name theirs after
 * the engine.
 *
 * A name list is a guess that ages, so it is a preference and not a
 * requirement: a platform with only a woman's German voice reads the reply in
 * it, because being read to in the wrong voice beats not being read to.
 */
/**
 * German voices known to be men, best first.
 *
 * The Web Speech API exposes no gender, so a name list is the only way to ask
 * for one. Ordered by how human they sound: the downloadable system voices
 * and Edge's natural voices first, and the Eloquence voices last — Eddy, Reed
 * and Rocko ship on every Mac since Ventura without a download, which makes
 * them the guarantee that a stock machine has *some* man to offer before the
 * fallback reaches for whoever is first.
 */
const PREFERRED_GERMAN_VOICES = [
  "markus",
  "yannick",
  "conrad",
  "killian",
  "florian",
  "jonas",
  "stefan",
  "hans",
  "klaus",
  "viktor",
  "eddy",
  "reed",
  "rocko",
  "grandpa",
];

/**
 * German voices known to be women, best first — Anna is macOS's default
 * German voice and needs no download, so a stock machine always has one.
 */
const PREFERRED_GERMAN_FEMALE_VOICES = [
  "anna",
  "katja",
  "petra",
  "helena",
  "marlene",
  "amala",
  "ingrid",
  "louisa",
  "gisela",
  "sandy",
  "shelley",
  "grandma",
];

export function pickGermanVoice(
  voices: readonly SpeechSynthesisVoice[],
  gender: "male" | "female" = "male",
): SpeechSynthesisVoice | undefined {
  const german = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("de"),
  );

  const names =
    gender === "female"
      ? PREFERRED_GERMAN_FEMALE_VOICES
      : PREFERRED_GERMAN_VOICES;
  const named = names
    .map((name) => german.find((voice) => voice.name.toLowerCase().includes(name)))
    .find((voice) => voice !== undefined);
  if (named) return named;

  // Some platforms label gender in the name itself ("German Male"). The male
  // test carries a guard, because "female" contains "male" and a bare
  // substring test would read the label as its own opposite.
  const label = gender === "female" ? /female/u : /(?<!fe)male/u;
  const labelled = german.find((voice) => label.test(voice.name.toLowerCase()));

  return labelled ?? german[0];
}

export function createBrowserSpeech(): SpeechVoice {
  const synth = () =>
    typeof window === "undefined" ? undefined : window.speechSynthesis;

  /**
   * The platform's voices, once it has loaded them.
   *
   * `getVoices()` is empty on the first call in most browsers and fills in
   * later, so asking once and believing the answer reports "no voices" on a
   * machine that has plenty.
   */
  const voices = async (): Promise<SpeechSynthesisVoice[]> => {
    const speech = synth();
    if (!speech) return [];

    const loaded = speech.getVoices();
    if (loaded.length > 0) return loaded;

    return new Promise((resolve) => {
      const settle = () => resolve(speech.getVoices());
      speech.addEventListener("voiceschanged", settle, { once: true });
      // Some platforms never fire it, and a promise nobody settles is a
      // reply that never finishes being read.
      setTimeout(settle, VOICE_LOAD_MS);
    });
  };

  return {
    supported() {
      return (
        synth() !== undefined && typeof SpeechSynthesisUtterance === "function"
      );
    },

    stop() {
      synth()?.cancel();
    },

    async speak(text, rate, gender = "male") {
      const speech = synth();
      if (!speech) throw new Error("this browser has no voice");

      const available = await voices();
      // A platform with no voices installed accepts an utterance, reports it
      // as finished, and plays nothing. Claiming to have read a reply out is
      // worse than saying we could not.
      if (available.length === 0)
        throw new Error("this browser has no voices installed");

      // One line at a time, like the audio player: two tutors talking over
      // each other is worse than silence.
      speech.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "de-DE";
      utterance.rate = rate;
      const german = pickGermanVoice(available, gender);
      try {
        if (german) utterance.voice = german;
      } catch {
        // Some platforms refuse a voice object they did not hand out. The
        // `lang` above already steers the choice, so the reply is still read
        // in German — just in whichever voice the platform prefers.
      }

      await new Promise<void>((resolve, reject) => {
        utterance.onend = () => resolve();
        utterance.onerror = () =>
          reject(new Error("that reply could not be spoken"));
        speech.speak(utterance);
      });
    },
  };
}

/** The formats a provider will take, best first. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

function bestMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function createBrowserCapture(): SpeechCapture {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;

  /**
   * Every exit releases the microphone. A page that keeps the recording
   * indicator lit after the learner has stopped talking is a page nobody
   * trusts with a microphone again.
   */
  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  };

  return {
    supported() {
      return (
        typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        bestMimeType() !== undefined
      );
    },

    async start() {
      chunks = [];
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = bestMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      startedAt = Date.now();
      recorder.start();
    },

    async stop() {
      const active = recorder;
      if (!active) throw new Error("nothing is being recorded");

      const durationMs = Date.now() - startedAt;

      const audio = await new Promise<Blob>((resolve) => {
        active.onstop = () =>
          resolve(new Blob(chunks, { type: active.mimeType || "audio/webm" }));
        active.stop();
      });

      release();
      return { audio, durationMs };
    },

    cancel() {
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } finally {
        release();
      }
    },
  };
}

export function createBrowserPlayback(): SpeechPlayback {
  let current: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const release = () => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    current = null;
  };

  return {
    supported() {
      return (
        typeof Audio !== "undefined" &&
        typeof URL.createObjectURL === "function"
      );
    },

    stop() {
      current?.pause();
      release();
    },

    play(audio) {
      // One line at a time. Two tutors talking over each other is worse than
      // silence, and the companion can only be doing one thing.
      this.stop();

      const url = URL.createObjectURL(audio);
      const element = new Audio(url);
      current = element;
      currentUrl = url;

      return new Promise<void>((resolve, reject) => {
        element.onended = () => {
          release();
          resolve();
        };
        element.onerror = () => {
          release();
          reject(new Error("that reply could not be played"));
        };
        element.play().catch((error: unknown) => {
          release();
          reject(
            error instanceof Error ? error : new Error("playback was refused"),
          );
        });
      });
    },
  };
}
