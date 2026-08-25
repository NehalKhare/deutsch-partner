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
  createOpenRouterSpeechToText,
  createOpenRouterTextToSpeech,
  wavFromPcm16,
} from "@/lib/ai/voice/openrouter";

const audio = (bytes = 1024) => new Uint8Array(bytes).fill(1);

const OPTIONS = {
  apiKey: "sk-voice-test-key",
  transcribeModelId: "openai/gpt-audio-mini",
  speechModelId: "openai/gpt-audio-mini",
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
  const said = (text: string, status = 200) =>
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status,
      headers: { "content-type": "application/json" },
    });

  const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>) =>
    JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));

  it("returns the text and the duration it was told", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(said("Guten Tag"));

    const outcome = await createOpenRouterSpeechToText({
      ...OPTIONS,
      fetchImpl,
    }).transcribe({ audio: audio(), format: "webm", durationMs: 4200 });

    expect(outcome).toMatchObject({
      text: "Guten Tag",
      durationMs: 4200,
      modelIdResolved: "openai/gpt-audio-mini",
    });
  });

  it("sends the recording as audio the model can hear, in the format it was recorded in", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(said("ja"));

    await createOpenRouterSpeechToText({ ...OPTIONS, fetchImpl }).transcribe({
      audio: audio(8),
      format: "webm",
      durationMs: 1000,
    });

    const body = bodyOf(fetchImpl);
    const parts = body.messages[0].content;
    expect(body.model).toBe("openai/gpt-audio-mini");
    expect(parts[1].type).toBe("input_audio");
    expect(parts[1].input_audio.format).toBe("webm");
    // Eight bytes of 0x01, base64. The bytes go in the body, never in a URL.
    expect(parts[1].input_audio.data).toBe("AQEBAQEBAQE=");
    // And it is told what it is listening to, in the language of the lesson.
    expect(parts[0].text).toMatch(/German/);
  });

  it("keeps its own words out of the transcript", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(said("  Ich heiße Alex  "));

    const outcome = await createOpenRouterSpeechToText({
      ...OPTIONS,
      fetchImpl,
    }).transcribe({ audio: audio(), format: "webm", durationMs: 1000 });

    expect(outcome.text).toBe("Ich heiße Alex");
  });

  it("sends the key as a bearer token and nowhere else", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(said("ja"));

    await createOpenRouterSpeechToText({ ...OPTIONS, fetchImpl }).transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-voice-test-key");
    expect(url).not.toContain("sk-voice-test-key");
  });

  it("never puts the key into the error it throws", async () => {
    const transport = createOpenRouterSpeechToText({
      ...OPTIONS,
      fetchImpl: vi.fn().mockResolvedValue(said("no", 413)),
    });

    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.toThrow(/413/);
    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.not.toThrow(/sk-voice-test-key/);
  });

  it("refuses a malformed response", async () => {
    const transport = createOpenRouterSpeechToText({
      ...OPTIONS,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ nope: true }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    await expect(
      transport.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.toThrow(/malformed/i);
  });
});

describe("wrapping raw samples for a browser", () => {
  it("writes a WAV header the samples can be played through", () => {
    const wav = wavFromPcm16(new Uint8Array([1, 2, 3, 4]));
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (at: number) =>
      String.fromCharCode(...wav.slice(at, at + 4));

    expect(wav.byteLength).toBe(44 + 4);
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + 4);
    expect(view.getUint16(20, true)).toBe(1); // uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    // The rate the stream is actually in. Wrong here means a chipmunk.
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
  });
});

describe("the speech transport", () => {
  /** A streamed completion, as OpenRouter frames one. */
  const streamed = (...frames: string[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

  const audioFrame = (base64: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: base64 } } }] })}\n\n`;

  /** Four bytes of PCM, as base64. */
  const PCM = "AQIDBA==";

  const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>) =>
    JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));

  it("returns playable audio and what it was billed on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM), "data: [DONE]\n\n"));

    const outcome = await createOpenRouterTextToSpeech({
      ...OPTIONS,
      fetchImpl,
    }).synthesize({ text: "Guten Tag" });

    // A container, not raw samples: nothing above this file should have to
    // know the provider streams headerless PCM.
    expect(outcome.format).toBe("wav");
    expect(outcome.audio.byteLength).toBe(44 + 4);
    expect(outcome.characters).toBe(9);
    expect(outcome.modelIdResolved).toBe("openai/gpt-audio-mini");
  });

  it("asks in the only shape that returns audio at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));

    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
    });

    const body = bodyOf(fetchImpl);
    // The provider refuses audio without both of these, in as many words.
    expect(body.stream).toBe(true);
    expect(body.audio.format).toBe("pcm16");
    expect(body.modalities).toEqual(["text", "audio"]);
    // A transport should not be creative about what it is reading.
    expect(body.temperature).toBe(0);
  });

  it("tells the model to read the line and nothing else", async () => {
    // Left to itself a chat model reads the sentence and then remarks on
    // having read it, out loud, in the tutor's voice.
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));

    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
    });

    const body = bodyOf(fetchImpl);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/no comment/i);
    expect(body.messages[1]).toEqual({ role: "user", content: "Guten Tag" });
  });

  it("maps the default voice onto the vendor's, rather than passing it through", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));

    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
    });

    expect(bodyOf(fetchImpl).audio.voice).toBe("ash");
    expect(bodyOf(fetchImpl).audio.voice).not.toBe("tutor_warm");
  });

  it("maps the female choice onto the vendor's female voice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));

    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
      gender: "female",
    });

    expect(bodyOf(fetchImpl).audio.voice).toBe("shimmer");
  });

  it("maps the domain's voice onto the vendor's", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));

    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl }).synthesize({
      text: "Guten Tag",
      voice: "tutor_neutral",
    });

    expect(bodyOf(fetchImpl).audio.voice).toBe("onyx");
  });

  it("asks for a beginner's pace in words, because a chat model takes no speed", async () => {
    const slow = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));
    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl: slow }).synthesize({
      text: "Guten Tag",
      speed: speechRateFor("A1"),
    });

    const quick = vi.fn().mockResolvedValue(streamed(audioFrame(PCM)));
    await createOpenRouterTextToSpeech({ ...OPTIONS, fetchImpl: quick }).synthesize({
      text: "Guten Tag",
      speed: speechRateFor("B1"),
    });

    expect(SPEECH_RATES.A1).toBeLessThan(SPEECH_RATES.B1);
    expect(bodyOf(slow).messages[0].content).toMatch(/slowly/i);
    expect(bodyOf(quick).messages[0].content).not.toMatch(/slowly/i);
  });

  it("survives a frame split across two network reads", async () => {
    // A read can end anywhere, including halfway through a base64 payload.
    const whole = audioFrame(PCM);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(streamed(whole.slice(0, 20), whole.slice(20)));

    const outcome = await createOpenRouterTextToSpeech({
      ...OPTIONS,
      fetchImpl,
    }).synthesize({ text: "Guten Tag" });

    expect(outcome.audio.byteLength).toBe(44 + 4);
  });

  it("ignores a frame that is not audio rather than failing on it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      streamed(
        ": keep-alive\n\n",
        `data: ${JSON.stringify({ choices: [{ delta: { content: "hm" } }] })}\n\n`,
        audioFrame(PCM),
        "data: [DONE]\n\n",
      ),
    );

    const outcome = await createOpenRouterTextToSpeech({
      ...OPTIONS,
      fetchImpl,
    }).synthesize({ text: "Guten Tag" });

    expect(outcome.audio.byteLength).toBe(44 + 4);
  });

  it("says so when a stream carried no audio at all", async () => {
    const transport = createOpenRouterTextToSpeech({
      ...OPTIONS,
      fetchImpl: vi.fn().mockResolvedValue(streamed("data: [DONE]\n\n")),
    });

    await expect(transport.synthesize({ text: "x" })).rejects.toThrow(/no audio/i);
  });

  it("reports a refusal by status and nothing else", async () => {
    // A provider's own message can quote the prompt back, and the prompt is
    // the tutor's German or the learner's own words.
    const transport = createOpenRouterTextToSpeech({
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
