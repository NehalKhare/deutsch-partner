import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserSpeech, pickGermanVoice } from "@/components/chat/speech";

/**
 * The browser's own voice.
 *
 * jsdom has no Web Speech API at all, so the platform is stood up here. That
 * is the only way to test this adapter, and it is worth testing: it is the
 * thing that reads a reply out when no speech key is configured, which is the
 * state most deployments of this will be in.
 */

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

const voice = (lang: string, name = lang) =>
  ({ lang, name, default: false, localService: true, voiceURI: name }) as
    SpeechSynthesisVoice;

function stubPlatform(
  options: {
    voices?: SpeechSynthesisVoice[];
    /** Voices arrive later, as they do in most browsers on the first call. */
    voicesArriveLate?: SpeechSynthesisVoice[];
    /** The platform refuses a voice object it did not hand out. */
    rejectsVoice?: boolean;
    fails?: boolean;
  } = {},
) {
  const spoken: FakeUtterance[] = [];
  const cancelled: number[] = [];
  let listener: (() => void) | null = null;
  let voices = options.voices ?? [];

  class Utterance implements FakeUtterance {
    lang = "";
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #voice: unknown = null;

    constructor(public text: string) {}

    get voice() {
      return this.#voice;
    }
    set voice(next: unknown) {
      if (options.rejectsVoice) throw new TypeError("not a SpeechSynthesisVoice");
      this.#voice = next;
    }
  }

  const synthesis = {
    getVoices: () => voices,
    cancel: () => cancelled.push(Date.now()),
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
      setTimeout(() => {
        if (options.fails) utterance.onerror?.();
        else utterance.onend?.();
      }, 0);
    },
    addEventListener: (_event: string, handler: () => void) => {
      listener = handler;
    },
  };

  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(globalThis, "window", {
    value: { ...(globalThis.window ?? {}), speechSynthesis: synthesis },
    configurable: true,
    writable: true,
  });

  return {
    spoken,
    cancelled,
    /** Delivers the voices a real platform would announce later. */
    deliverVoices() {
      voices = options.voicesArriveLate ?? [];
      listener?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the browser can do", () => {
  it("offers itself when the platform has speech", () => {
    stubPlatform({ voices: [voice("de-DE")] });

    expect(createBrowserSpeech().supported()).toBe(true);
  });

  it("does not offer itself on a platform with no speech at all", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    Object.defineProperty(globalThis, "window", {
      value: { speechSynthesis: undefined },
      configurable: true,
      writable: true,
    });

    expect(createBrowserSpeech().supported()).toBe(false);
  });
});

describe("reading a reply out", () => {
  it("says the German, in German, at the pace it was given", async () => {
    const platform = stubPlatform({ voices: [voice("de-DE", "Anna")] });

    await createBrowserSpeech().speak("Wie geht es dir?", 0.85);

    expect(platform.spoken).toHaveLength(1);
    expect(platform.spoken[0]).toMatchObject({
      text: "Wie geht es dir?",
      lang: "de-DE",
      rate: 0.85,
    });
  });

  it("speaks in the voice the learner chose", async () => {
    const platform = stubPlatform({
      voices: [voice("de-DE", "Anna"), voice("de-DE", "Markus")],
    });

    await createBrowserSpeech().speak("Guten Tag", 1, "female");

    expect((platform.spoken[0]?.voice as SpeechSynthesisVoice)?.name).toBe("Anna");
  });

  it("prefers a man, because the tutor is one", async () => {
    // The Web Speech API exposes no gender, so the only way to ask for a man
    // is to know which German voices are men.
    const platform = stubPlatform({
      voices: [voice("de-DE", "Anna"), voice("de-DE", "Markus")],
    });

    await createBrowserSpeech().speak("Guten Tag", 1);

    expect((platform.spoken[0]?.voice as SpeechSynthesisVoice)?.name).toBe("Markus");
  });

  it("reads it in whatever German voice there is rather than not at all", async () => {
    // A name list is a guess that ages. Being read to in the wrong voice beats
    // being read to in none.
    const platform = stubPlatform({ voices: [voice("de-DE", "Anna")] });

    await createBrowserSpeech().speak("Guten Tag", 1);

    expect((platform.spoken[0]?.voice as SpeechSynthesisVoice)?.name).toBe("Anna");
  });

  it("picks a German voice when the platform has one", async () => {
    const german = voice("de-DE", "Anna");
    const platform = stubPlatform({ voices: [voice("en-GB", "Daniel"), german] });

    await createBrowserSpeech().speak("Guten Tag", 1);

    expect(platform.spoken[0]?.voice).toBe(german);
  });

  it("leaves the choice to the platform when it has no German one", async () => {
    // `lang` is still de-DE, so a platform that can synthesise German will.
    const platform = stubPlatform({ voices: [voice("en-GB", "Daniel")] });

    await createBrowserSpeech().speak("Guten Tag", 1);

    expect(platform.spoken[0]?.voice).toBeNull();
    expect(platform.spoken[0]?.lang).toBe("de-DE");
  });

  it("still reads the reply when the platform refuses the voice object", async () => {
    // Some browsers reject a voice they did not hand out themselves. Losing
    // the preferred voice is not a reason to lose the reply.
    const platform = stubPlatform({
      voices: [voice("de-DE", "Anna")],
      rejectsVoice: true,
    });

    await createBrowserSpeech().speak("Guten Tag", 1);

    expect(platform.spoken).toHaveLength(1);
    expect(platform.spoken[0]?.lang).toBe("de-DE");
  });

  it("stops whatever was being read before starting", async () => {
    // Two tutors talking over each other is worse than silence.
    const platform = stubPlatform({ voices: [voice("de-DE")] });

    await createBrowserSpeech().speak("Eins", 1);

    expect(platform.cancelled).toHaveLength(1);
  });

  it("waits for a platform that announces its voices late", async () => {
    const platform = stubPlatform({
      voices: [],
      voicesArriveLate: [voice("de-DE", "Anna")],
    });
    const speech = createBrowserSpeech();

    const spoken = speech.speak("Guten Tag", 1);
    platform.deliverVoices();
    await spoken;

    expect(platform.spoken).toHaveLength(1);
  });

  it("refuses rather than pretending, on a platform with no voices installed", async () => {
    // Headless browsers and bare Linux boxes accept an utterance, report it
    // finished, and play nothing. Claiming to have read a reply out loud when
    // nobody heard it is the one outcome worse than saying we could not.
    const platform = stubPlatform({ voices: [], voicesArriveLate: [] });
    const speech = createBrowserSpeech();

    const spoken = speech.speak("Guten Tag", 1);
    platform.deliverVoices();

    await expect(spoken).rejects.toThrow(/no voices/i);
    expect(platform.spoken).toHaveLength(0);
  });

  it("reports a platform that fails mid-sentence", async () => {
    const platform = stubPlatform({ voices: [voice("de-DE")], fails: true });

    await expect(createBrowserSpeech().speak("Guten Tag", 1)).rejects.toThrow();
    expect(platform.spoken).toHaveLength(1);
  });

  it("goes quiet when asked", () => {
    const platform = stubPlatform({ voices: [voice("de-DE")] });

    createBrowserSpeech().stop();

    expect(platform.cancelled).toHaveLength(1);
  });
});

describe("choosing among a platform's voices", () => {
  it("takes a known man's voice over another German one, whatever the order", () => {
    const anna = voice("de-DE", "Anna");
    const stefan = voice("de-DE", "Microsoft Stefan");

    expect(pickGermanVoice([anna, stefan])).toBe(stefan);
    expect(pickGermanVoice([stefan, anna])).toBe(stefan);
  });

  it("keeps to German even when an English man is on offer", () => {
    // A German sentence read in an English voice is not a lesson, it is a joke.
    const daniel = voice("en-GB", "Daniel");
    const anna = voice("de-DE", "Anna");

    expect(pickGermanVoice([daniel, anna])).toBe(anna);
  });

  it("takes the first name on the list when a platform has several men", () => {
    const yannick = voice("de-DE", "Yannick");
    const markus = voice("de-DE", "Markus");

    expect(pickGermanVoice([yannick, markus])).toBe(markus);
  });

  it("finds nothing when the platform speaks no German", () => {
    expect(pickGermanVoice([voice("en-GB", "Daniel")])).toBeUndefined();
    expect(pickGermanVoice([])).toBeUndefined();
  });

  it("finds a man on a stock Mac, where Anna is the only downloaded voice", () => {
    // Eddy, Reed and Rocko ship with macOS since Ventura in every language.
    // They sound like cartoons, but a cartoon man beats a wrong-gender tutor.
    const anna = voice("de-DE", "Anna");
    const eddy = voice("de-DE", "Eddy (German (Germany))");

    expect(pickGermanVoice([anna, eddy])).toBe(eddy);
  });

  it("prefers a human-sounding man over an Eloquence one", () => {
    const eddy = voice("de-DE", "Eddy (German (Germany))");
    const markus = voice("de-DE", "Markus (Enhanced)");

    expect(pickGermanVoice([eddy, markus])).toBe(markus);
  });

  it("reads an explicit gender label, without mistaking female for male", () => {
    // "female" contains "male": a bare substring test would pick the exact
    // voice the learner asked to be rid of.
    const female = voice("de-DE", "German Germany Female");
    const male = voice("de-DE", "German Germany Male");

    expect(pickGermanVoice([female, male])).toBe(male);
    expect(pickGermanVoice([male, female])).toBe(male);
  });

  it("never treats a female label as a match on its own", () => {
    const female = voice("de-DE", "German Germany Female");
    const anna = voice("de-DE", "Anna");

    // With no man anywhere, the first German voice wins — the label must not
    // have promoted "Female" over the plain candidate as though it were male.
    expect(pickGermanVoice([anna, female])).toBe(anna);
  });

  it("honours a learner who chose the female voice", () => {
    const anna = voice("de-DE", "Anna");
    const markus = voice("de-DE", "Markus");

    expect(pickGermanVoice([markus, anna], "female")).toBe(anna);
    expect(pickGermanVoice([markus, anna], "male")).toBe(markus);
  });

  it("reads a female gender label as female", () => {
    const labelled = voice("de-DE", "German Germany Female");
    const eddy = voice("de-DE", "Eddy");

    expect(pickGermanVoice([eddy, labelled], "female")).toBe(labelled);
  });

  it("still reads aloud for a female choice on a machine with only men", () => {
    const markus = voice("de-DE", "Markus");

    expect(pickGermanVoice([markus], "female")).toBe(markus);
  });

  it("reads a name however the platform capitalises it", () => {
    const shouty = voice("DE-AT", "MARKUS (Enhanced)");

    expect(pickGermanVoice([shouty])).toBe(shouty);
  });
});
