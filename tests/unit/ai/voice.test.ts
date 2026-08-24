import { describe, expect, it, vi } from "vitest";

import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  SPEECH_RATES,
  checkAudio,
  speechRateFor,
  synthesisRequestSchema,
  transcriptionRequestSchema,
} from "@/lib/ai/voice/providers";
import {
  createOpenAISpeechToText,
  createOpenAITextToSpeech,
} from "@/lib/ai/voice/openai";

const audio = (bytes = 1024) => new Uint8Array(bytes).fill(1);

const OPTIONS = {
  apiKey: "sk-voice-test-key",
  transcribeModelId: "openai/whisper-1",
  speechModelId: "openai/gpt-4o-mini-tts",
};

describe("what the domain may ask for", () => {
  it("takes audio, a format and a duration", () => {
    expect(
      transcriptionRequestSchema.safeParse({
        audio: audio(),
        format: "webm",
        durationMs: 4000,
      }).success,
    ).toBe(true);
  });

  it("assumes German, because this is a German lesson", () => {
    const parsed = transcriptionRequestSchema.parse({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    expect(parsed.language).toBe("de");
  });

  it("refuses empty audio", () => {
    expect(
      transcriptionRequestSchema.safeParse({
        audio: new Uint8Array(0),
        format: "webm",
        durationMs: 1000,
      }).success,
    ).toBe(false);
  });

  it("accepts bytes that were made in another realm", () => {
    // A recording is the same recording whichever realm allocated it — a
    // worker, a polyfilled encoder, a Node Buffer. Checking `instanceof` here
    // would refuse perfectly good audio for a reason no caller can act on.
    for (const bytes of [
      new TextEncoder().encode("pretend this is audio"),
      Buffer.from("pretend this is audio"),
    ]) {
      expect(
        transcriptionRequestSchema.safeParse({
          audio: bytes,
          format: "webm",
          durationMs: 1000,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    ["a plain array of numbers", [1, 2, 3]],
    ["a wider element type", new Int16Array(8)],
    ["a signed byte array", new Int8Array(8)],
    ["an unframed buffer", new ArrayBuffer(8)],
    ["a view with no element type", new DataView(new ArrayBuffer(8))],
    ["a string of bytes", "\u0001\u0002"],
  ])("still refuses %s", (_label, audio) => {
    expect(
      transcriptionRequestSchema.safeParse({
        audio,
        format: "webm",
        durationMs: 1000,
      }).success,
    ).toBe(false);
  });

  it("names voices rather than enumerating a vendor's", () => {
    // A domain that names "ash" is a domain that cannot change vendor.
    const parsed = synthesisRequestSchema.parse({ text: "Guten Tag" });

    expect(parsed.voice).toBe("tutor_warm");
  });

  it("refuses a speed nobody could understand", () => {
    expect(synthesisRequestSchema.safeParse({ text: "x", speed: 4 }).success).toBe(false);
  });

  it("speaks more slowly at a lower level", () => {
    expect(speechRateFor("A1")).toBeLessThan(speechRateFor("B1"));
    expect(SPEECH_RATES.B1).toBe(1);
  });
});

describe("bounding audio before it is uploaded", () => {
  it("accepts a reasonable clip", () => {
    expect(checkAudio({ bytes: 100_000, durationMs: 8000, format: "webm" }).ok).toBe(true);
  });

  it("refuses an oversized upload", () => {
    // A provider would refuse it too, but only after it had been sent — which
    // is the upload the abuse was.
    expect(
      checkAudio({ bytes: MAX_AUDIO_BYTES + 1, durationMs: 1000, format: "webm" }),
    ).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("refuses a clip longer than a session should carry", () => {
    expect(
      checkAudio({ bytes: 1000, durationMs: MAX_AUDIO_MS + 1, format: "webm" }),
    ).toMatchObject({ ok: false, reason: "too_long" });
  });

  it("refuses a format it does not accept", () => {
    expect(checkAudio({ bytes: 1000, durationMs: 1000, format: "flac" })).toMatchObject({
      ok: false,
      reason: "unsupported_format",
    });
  });

  it("refuses nothing at all", () => {
    expect(checkAudio({ bytes: 0, durationMs: 1000, format: "webm" })).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });
});

describe("the transcription transport", () => {
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("returns the text and the duration it was told", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ text: "Guten Tag" }));

    const outcome = await createOpenAISpeechToText({ ...OPTIONS, fetchImpl }).transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 4200,
    });

    expect(outcome).toMatchObject({
      text: "Guten Tag",
      durationMs: 4200,
      modelIdResolved: "whisper-1",
    });
  });

  it("strips the registry's vendor prefix", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ text: "ja" }));

    await createOpenAISpeechToText({ ...OPTIONS, fetchImpl }).transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    const form = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("de");
  });

  it("sends the key as a bearer token and nowhere else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ text: "ja" }));

    await createOpenAISpeechToText({ ...OPTIONS, fetchImpl }).transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-voice-test-key");
    expect(url).not.toContain("sk-voice-test-key");
  });

  it("never puts the key into the error it throws", async () => {
    const transport = createOpenAISpeechToText({
      ...OPTIONS,
      fetchImpl: vi.fn().mockResolvedValue(response({ error: "no" }, 413)),
    });

    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.toThrow(/413/);
    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.not.toThrow(/sk-voice-test-key/);
  });

  it("refuses a malformed response", async () => {
    const transport = createOpenAISpeechToText({
      ...OPTIONS,
      fetchImpl: vi.fn().mockResolvedValue(response({ nope: true })),
    });

    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.toThrow(/malformed/i);
  });
});

describe("the speech transport", () => {
  const audioResponse = () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });

  it("returns bytes and what it was billed on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse());

    const outcome = await createOpenAITextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
    });

    expect(outcome.audio.byteLength).toBe(3);
    expect(outcome.characters).toBe(9);
    expect(outcome.format).toBe("mp3");
  });

  it("maps the default voice onto the vendor's, rather than passing it through", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse());

    await createOpenAITextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    );

    expect(body.voice).toBe("ash");
    expect(body.voice).not.toBe("tutor_warm");
  });

  it("maps the female choice onto the vendor's female voice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse());

    await createOpenAITextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
      gender: "female",
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    );

    expect(body.voice).toBe("shimmer");
    expect(body.voice).not.toBe("female");
  });

  it("maps the domain's voice onto the vendor's", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse());

    await createOpenAITextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
      voice: "tutor_neutral",
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    );

    expect(body.voice).toBe("onyx");
    expect(body.model).toBe("gpt-4o-mini-tts");
  });

  it("sends the speed the level asked for", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse());

    await createOpenAITextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
      speed: speechRateFor("A1"),
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    );

    expect(body.speed).toBe(SPEECH_RATES.A1);
  });

  it("reports a refusal by status and nothing else", async () => {
    // A provider's own message can quote the prompt back, and the prompt is
    // the tutor's German or the learner's own words.
    const transport = createOpenAITextToSpeech({
      ...OPTIONS,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response("quota exceeded for key sk-x", { status: 429 })),
    });

    await expect(transport.synthesize({ text: "x" })).rejects.toThrow(
      /^Speech request failed with status 429$/,
    );
  });
});
