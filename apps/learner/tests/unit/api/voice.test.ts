import { describe, expect, it, vi } from "vitest";

import {
  createMockSpeechToText,
  createMockTextToSpeech,
} from "@dp/gateway/voice/mock";
import { SPEECH_RATES } from "@dp/domain/speech";
import { AUDIO_FORMATS, MAX_AUDIO_BYTES, MAX_AUDIO_MS } from "@dp/gateway/voice/providers";
import {
  MAX_SPOKEN_CHARACTERS,
  audioFormatFromMimeType,
  MAX_TURN_AUDIO_MS,
  VOICE_FAILURES,
  handleSynthesis,
  handleTranscription,
  voiceErrorResponse,
} from "@/lib/api/voice";

/**
 * Speaking and being spoken to.
 *
 * Driven by the in-memory doubles rather than a fake fetch, which is the point
 * of having built them: these tests exercise the same validation the real
 * provider applies, and the round-trip lets a spoken line come back as itself
 * without a network or a key.
 */

const audio = (bytes = 2048) => new Uint8Array(bytes).fill(7);

const clip = (over: Partial<Parameters<typeof handleTranscription>[0]> = {}) => ({
  audio: audio(),
  format: "webm",
  durationMs: 3_000,
  ...over,
});

describe("hearing the learner", () => {
  it("returns what was said", async () => {
    const stt = createMockSpeechToText({ transcript: "Ich möchte einen Kaffee." });

    const result = await handleTranscription(clip(), stt);

    expect(result).toEqual({ ok: true, data: { text: "Ich möchte einen Kaffee." } });
  });

  it("tells the provider it is German, because this is a German lesson", async () => {
    const stt = createMockSpeechToText();

    await handleTranscription(clip(), stt);

    expect(stt.calls[0]).toMatchObject({ language: "de", format: "webm" });
  });

  it("trims what came back, so a stray space is not a message", async () => {
    const stt = createMockSpeechToText({ transcript: "  Hallo  " });

    const result = await handleTranscription(clip(), stt);

    expect(result.ok && result.data.text).toBe("Hallo");
  });

  it("treats an empty transcript as having heard nothing", async () => {
    // Whisper answers a silent clip with an empty string, and an empty string
    // is not a turn.
    const stt = createMockSpeechToText({ transcript: "   " });

    const result = await handleTranscription(clip(), stt);

    expect(result).toEqual({ ok: false, error: "no_audio" });
  });
});

describe("what is refused before a byte is uploaded", () => {
  it.each([
    ["nothing at all", { audio: new Uint8Array(0) }, "no_audio"],
    ["more bytes than a clip should be", { audio: audio(MAX_AUDIO_BYTES + 1) }, "audio_too_large"],
    ["a format nobody records", { format: "flac" }, "unsupported_format"],
    ["longer than a spoken turn", { durationMs: MAX_TURN_AUDIO_MS + 1 }, "audio_too_long"],
    ["longer than any provider takes", { durationMs: MAX_AUDIO_MS + 1 }, "audio_too_long"],
  ] as const)("refuses %s", async (_label, over, expected) => {
    const stt = createMockSpeechToText();

    const result = await handleTranscription(clip(over), stt);

    expect(result).toEqual({ ok: false, error: expected });
    // The point of checking here: the provider is never asked.
    expect(stt.calls).toHaveLength(0);
  });

  it("bounds a turn more tightly than a provider would", async () => {
    // The provider's limit is five minutes. A conversational turn is not.
    expect(MAX_TURN_AUDIO_MS).toBeLessThan(MAX_AUDIO_MS);
  });

  it("says speaking is unavailable rather than failing oddly with no key", async () => {
    const result = await handleTranscription(clip(), null);

    expect(result).toEqual({ ok: false, error: "voice_unavailable" });
  });

  it("never repeats what the provider said about the learner's audio", async () => {
    // A transcription provider's error can quote the audio back at you.
    const stt = createMockSpeechToText({
      failWith: new Error("could not transcribe: 'Ich möchte einen Kaffee'"),
    });

    const result = await handleTranscription(clip(), stt);

    expect(result).toEqual({ ok: false, error: "provider_error" });
    expect(voiceErrorResponse("provider_error").message).not.toMatch(/Kaffee/);
  });
});

describe("speaking to the learner", () => {
  it("returns audio for a line", async () => {
    const tts = createMockTextToSpeech();

    const result = await handleSynthesis({ text: "Wie geht es dir?" }, tts);

    expect(result.ok && result.data.audio.byteLength).toBeGreaterThan(0);
    expect(result.ok && result.data.format).toBe("mp3");
  });

  it("speaks more slowly at a lower level", async () => {
    const tts = createMockTextToSpeech();

    await handleSynthesis({ text: "Wie geht es dir?", cefr: "A1" }, tts);
    await handleSynthesis({ text: "Wie geht es dir?", cefr: "B1" }, tts);

    expect(tts.calls[0]?.speed).toBe(SPEECH_RATES.A1);
    expect(tts.calls[1]?.speed).toBe(SPEECH_RATES.B1);
    expect(tts.calls[0]?.speed).toBeLessThan(tts.calls[1]?.speed ?? 0);
  });

  it("asks for a named voice and never a vendor's", async () => {
    const tts = createMockTextToSpeech();

    await handleSynthesis({ text: "Guten Tag" }, tts);

    expect(tts.calls[0]?.voice).toBe("tutor_warm");
    expect(JSON.stringify(tts.calls)).not.toMatch(/shimmer|alloy|nova|echo/i);
  });

  it("passes the learner's chosen voice through to the provider", async () => {
    const tts = createMockTextToSpeech();

    await handleSynthesis({ text: "Guten Tag", voice: "female" }, tts);
    await handleSynthesis({ text: "Guten Tag" }, tts);

    expect(tts.calls[0]?.gender).toBe("female");
    // Unstated means the persona as shipped, which is male.
    expect(tts.calls[1]?.gender).toBe("male");
  });

  it("refuses a voice the product does not have", async () => {
    const tts = createMockTextToSpeech();

    const result = await handleSynthesis({ text: "Guten Tag", voice: "robot" }, tts);

    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("assumes the slowest pace when no level is given", async () => {
    // Too slow is followable. Too fast is not.
    const tts = createMockTextToSpeech();

    await handleSynthesis({ text: "Guten Tag" }, tts);

    expect(tts.calls[0]?.speed).toBe(SPEECH_RATES.A1);
  });

  it.each([
    ["nothing to say", { text: "" }],
    ["only whitespace", { text: "   " }],
    ["more than a reply's worth", { text: "a".repeat(MAX_SPOKEN_CHARACTERS + 1) }],
    ["a level nobody teaches", { text: "Hallo", cefr: "C2" }],
    ["a field nobody declared", { text: "Hallo", voice: "shimmer" }],
    ["not an object at all", "Hallo"],
  ])("refuses %s", async (_label, body) => {
    const tts = createMockTextToSpeech();

    const result = await handleSynthesis(body, tts);

    expect(result).toEqual({ ok: false, error: "invalid_body" });
    expect(tts.calls).toHaveLength(0);
  });

  it("caps a spoken line well below what the provider would take", async () => {
    // The tutor's own ceiling is 700 output tokens; this is the same order.
    expect(MAX_SPOKEN_CHARACTERS).toBeLessThanOrEqual(4_000);
  });

  it("says speaking is unavailable rather than failing oddly with no key", async () => {
    const result = await handleSynthesis({ text: "Guten Tag" }, null);

    expect(result).toEqual({ ok: false, error: "voice_unavailable" });
  });
});

describe("a spoken turn, end to end", () => {
  it("hears back the line it spoke", async () => {
    // The doubles round-trip, so this is the whole loop — tutor speaks, the
    // audio comes back as the learner's, and it is the same German.
    const tts = createMockTextToSpeech();
    const stt = createMockSpeechToText();

    const spoken = await handleSynthesis({ text: "Wie war dein Wochenende?" }, tts);
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;

    const heard = await handleTranscription(
      { audio: spoken.data.audio, format: "mp3", durationMs: 4_000 },
      stt,
    );

    expect(heard.ok && heard.data.text).toBe("Wie war dein Wochenende?");
  });
});

describe("reading what the browser recorded in", () => {
  it.each([
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
    ["audio/ogg; codecs=opus", "ogg"],
    ["AUDIO/WEBM", "webm"],
  ])("reads %s as %s", (mimeType, expected) => {
    expect(audioFormatFromMimeType(mimeType)).toBe(expected);
  });

  it.each([
    ["nothing at all", ""],
    ["a bare container with no type", "webm"],
    ["something that is not audio", "video/webm"],
    ["a type with no subtype", "audio/"],
    ["a path pretending to be a subtype", "audio/../../etc/passwd"],
    ["a subtype nobody records", "audio/flac"],
  ])("gives nothing the format list accepts for %s", (_label, mimeType) => {
    // The property that matters: a caller's string cannot be massaged into
    // one of the accepted formats.
    expect(AUDIO_FORMATS as readonly string[]).not.toContain(
      audioFormatFromMimeType(mimeType),
    );
  });

  it("refuses a recording whose type it could not read", async () => {
    const stt = createMockSpeechToText();

    const result = await handleTranscription(
      clip({ format: audioFormatFromMimeType("video/webm") }),
      stt,
    );

    expect(result).toEqual({ ok: false, error: "unsupported_format" });
    expect(stt.calls).toHaveLength(0);
  });
});

describe("the plan's daily voice allowance", () => {
  // Counted last: a clip the checks above would refuse, or a body that does
  // not parse, has used nothing (billing-and-plans-spec.md S2). Free has five
  // spoken answers a day, and a browser that records an odd format must not
  // be able to spend them.
  const RESET = new Date("2026-10-02T09:30:00.000Z");
  const allowed = () => vi.fn(async () => ({ allowed: true as const, remaining: 3, resetAt: RESET }));
  const exhausted = () =>
    vi.fn(async () => ({ allowed: false as const, refusal: "quota_exhausted" as const, resetAt: RESET }));

  it.each([
    ["an empty clip", { audio: new Uint8Array(0) }],
    ["a format nobody records", { format: "flac" }],
    ["a clip longer than a spoken turn", { durationMs: MAX_TURN_AUDIO_MS + 1 }],
  ] as const)("counts nothing for %s", async (_label, over) => {
    const admit = allowed();

    await handleTranscription(clip(over), createMockSpeechToText(), admit);

    expect(admit).not.toHaveBeenCalled();
  });

  it("counts a clip that passed every check, once, before the provider hears it", async () => {
    const admit = allowed();
    const stt = createMockSpeechToText({ transcript: "Hallo" });

    expect(await handleTranscription(clip(), stt, admit)).toMatchObject({ ok: true });
    expect(admit).toHaveBeenCalledTimes(1);
    expect(stt.calls).toHaveLength(1);
  });

  it("refuses a spent allowance with when it reopens, and uploads nothing", async () => {
    const stt = createMockSpeechToText();

    const result = await handleTranscription(clip(), stt, exhausted());

    expect(result).toEqual({ ok: false, error: "quota_exhausted", resetAt: RESET });
    expect(stt.calls).toHaveLength(0);
  });

  it("answers a quota store that could not count as the voice being unavailable, not a spent day", async () => {
    const stt = createMockSpeechToText();
    const down = vi.fn(async () => ({ allowed: false as const, refusal: "unavailable" as const, resetAt: null }));

    expect(await handleTranscription(clip(), stt, down)).toEqual({ ok: false, error: "voice_unavailable" });
    expect(await handleSynthesis({ text: "Hallo!" }, createMockTextToSpeech(), down)).toEqual({
      ok: false,
      error: "voice_unavailable",
    });
    expect(stt.calls).toHaveLength(0);
  });

  it("counts nothing for a line that does not parse", async () => {
    const admit = allowed();

    await handleSynthesis({ text: "" }, createMockTextToSpeech(), admit);

    expect(admit).not.toHaveBeenCalled();
  });

  it("refuses a plan without the model voice before the provider is asked", async () => {
    const tts = createMockTextToSpeech();
    const admit = vi.fn(async () => ({
      allowed: false as const,
      refusal: "plan_required" as const,
      resetAt: null,
    }));

    const result = await handleSynthesis({ text: "Hallo!" }, tts, admit);

    expect(result).toEqual({ ok: false, error: "plan_required", resetAt: null });
    expect(tts.calls).toHaveLength(0);
  });

  it("tells the admission where the line is read, so the Trainer's voice can be its own feature", async () => {
    // Voice in the Trainer is Premium's (spec S2). A wrong claim can only
    // spend voice lines the plan already has; the quota is the bound.
    const admit = allowed();

    await handleSynthesis({ text: "Hallo!", surface: "trainer" }, createMockTextToSpeech(), admit);
    await handleSynthesis({ text: "Hallo!" }, createMockTextToSpeech(), admit);

    expect(admit).toHaveBeenNthCalledWith(1, { surface: "trainer" });
    expect(admit).toHaveBeenNthCalledWith(2, { surface: "chat" });
  });

  it("refuses a surface the product does not have", async () => {
    const admit = allowed();

    expect(await handleSynthesis({ text: "Hallo!", surface: "radio" }, createMockTextToSpeech(), admit)).toEqual({
      ok: false,
      error: "invalid_body",
    });
    expect(admit).not.toHaveBeenCalled();
  });

  it("counts nothing when speaking is not configured at all", async () => {
    const admit = allowed();

    await handleSynthesis({ text: "Hallo!" }, null, admit);
    await handleTranscription(clip(), null, admit);

    expect(admit).not.toHaveBeenCalled();
  });

  it("names both refusals, with the status a client branches on", () => {
    expect(VOICE_FAILURES).toEqual(expect.arrayContaining(["plan_required", "quota_exhausted"]));
    expect(voiceErrorResponse("plan_required").status).toBe(402);
    expect(voiceErrorResponse("quota_exhausted").status).toBe(429);
  });
});

describe("what a learner is told", () => {
  it("has a message and a status for every way this can fail", () => {
    for (const failure of VOICE_FAILURES) {
      const response = voiceErrorResponse(failure);
      expect(response.message.length).toBeGreaterThan(0);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("names no provider, model, table or internal cause", () => {
    for (const failure of VOICE_FAILURES) {
      expect(voiceErrorResponse(failure).message).not.toMatch(
        /openai|whisper|postgres|supabase|zod|token|api key|null|undefined/i,
      );
    }
  });

  it("tells somebody who spoke too long what the limit actually is", () => {
    expect(voiceErrorResponse("audio_too_long").message).toContain(
      String(MAX_TURN_AUDIO_MS / 1000),
    );
  });

  it("distinguishes refusing from breaking", () => {
    // A bad recording is the caller's to fix; a dead provider is not.
    expect(voiceErrorResponse("audio_too_large").status).toBe(413);
    expect(voiceErrorResponse("unauthenticated").status).toBe(401);
    expect(voiceErrorResponse("rate_limited").status).toBe(429);
    expect(voiceErrorResponse("provider_error").status).toBeGreaterThanOrEqual(500);
    expect(voiceErrorResponse("voice_unavailable").status).toBeGreaterThanOrEqual(500);
  });
});
