import { describe, expect, it, vi } from "vitest";

import {
  MOCK_TRANSCRIPT,
  createMockSpeechToText,
  createMockTextToSpeech,
} from "../src/voice/mock";
import {
  createOpenRouterSpeechToText,
  createOpenRouterTextToSpeech,
} from "../src/voice/openrouter";
import { MAX_AUDIO_MS, SPEECH_VOICES } from "../src/voice/providers";

/**
 * The mocks the build spec asks for, and the property that makes them worth
 * having: a double that accepts what the real provider would refuse hides the
 * bug it was supposed to catch. So most of this file is parity — the same
 * malformed request put to both, required to be refused by both.
 */

const audio = (bytes = 1024) => new Uint8Array(bytes).fill(1);

/** The real transports, wired to a fetch that fails the test if it is called. */
function realProviders() {
  const call = vi.fn(async () => {
    throw new Error("the transport reached the network for an invalid request");
  });

  const options = {
    apiKey: "sk-parity-test-key",
    transcribeModelId: "openai/gpt-audio-mini",
    speechModelId: "openai/gpt-audio-mini",
    fetchImpl: call as unknown as typeof fetch,
  };

  return {
    stt: createOpenRouterSpeechToText(options),
    tts: createOpenRouterTextToSpeech(options),
    call,
  };
}

describe("the speech-to-text mock", () => {
  it("returns the transcript it was configured with", async () => {
    const stt = createMockSpeechToText({ transcript: "Ich heiße Alex" });

    const result = await stt.transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 2000,
    });

    expect(result.text).toBe("Ich heiße Alex");
  });

  it("echoes the duration it was told, exactly as the real one does", async () => {
    const stt = createMockSpeechToText();

    const result = await stt.transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 4321,
    });

    expect(result.durationMs).toBe(4321);
  });

  it("says it is a mock in the field that reaches the ledger", async () => {
    // A ledger row or a log line from a mock must be unmistakable. A fake
    // transcription recorded against a real model id is a lie in the audit
    // trail, and the row is the only place anyone would ever look.
    const stt = createMockSpeechToText();

    const result = await stt.transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    expect(result.modelIdResolved).toMatch(/^mock\//);
  });

  it("records what the domain asked for, so a caller can be tested", async () => {
    const stt = createMockSpeechToText();

    await stt.transcribe({ audio: audio(64), format: "mp3", durationMs: 900 });

    expect(stt.calls).toHaveLength(1);
    expect(stt.calls[0]).toMatchObject({
      format: "mp3",
      durationMs: 900,
      language: "de",
    });
  });

  it("fails on demand, so a caller's failure path is reachable", async () => {
    const stt = createMockSpeechToText({ failWith: new Error("provider down") });

    await expect(
      stt.transcribe({ audio: audio(), format: "webm", durationMs: 1000 }),
    ).rejects.toThrow("provider down");
  });

  it("counts a failed call as a call, because the caller made one", async () => {
    const stt = createMockSpeechToText({ failWith: new Error("provider down") });

    await stt
      .transcribe({ audio: audio(), format: "webm", durationMs: 1000 })
      .catch(() => undefined);

    expect(stt.calls).toHaveLength(1);
  });
});

describe("the text-to-speech mock", () => {
  it("returns bytes in the format that was asked for", async () => {
    const tts = createMockTextToSpeech();

    const result = await tts.synthesize({ text: "Guten Tag", format: "wav" });

    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.format).toBe("wav");
  });

  it("bills on characters, exactly as the real one does", async () => {
    const tts = createMockTextToSpeech();

    const result = await tts.synthesize({ text: "Guten Tag" });

    expect(result.characters).toBe("Guten Tag".length);
  });

  it("says it is a mock in the field that reaches the ledger", async () => {
    const tts = createMockTextToSpeech();

    const result = await tts.synthesize({ text: "Guten Tag" });

    expect(result.modelIdResolved).toMatch(/^mock\//);
  });

  it("records the domain's voice name and never a vendor's", async () => {
    // The whole point of the abstraction. If a vendor voice ever appears in
    // what a provider was handed, something above this layer knows a vendor.
    const tts = createMockTextToSpeech();

    await tts.synthesize({ text: "Guten Tag", voice: "tutor_warm" });

    expect(tts.calls[0]?.voice).toBe("tutor_warm");
    expect(JSON.stringify(tts.calls)).not.toMatch(/shimmer|alloy|nova|echo/i);
  });

  it("fails on demand", async () => {
    const tts = createMockTextToSpeech({ failWith: new Error("provider down") });

    await expect(tts.synthesize({ text: "Guten Tag" })).rejects.toThrow(
      "provider down",
    );
  });
});

describe("the two mocks together", () => {
  it("round-trips: what was spoken is what comes back transcribed", async () => {
    // This is what makes an end-to-end voice test possible with no network
    // and no key: synthesise a line, hand the bytes back, get the line.
    const tts = createMockTextToSpeech();
    const stt = createMockSpeechToText();

    const spoken = await tts.synthesize({ text: "Wie war dein Wochenende?" });
    const heard = await stt.transcribe({
      audio: spoken.audio,
      format: spoken.format,
      durationMs: 3000,
    });

    expect(heard.text).toBe("Wie war dein Wochenende?");
  });

  it("round-trips text the encoding could plausibly break", async () => {
    const tts = createMockTextToSpeech();
    const stt = createMockSpeechToText();

    const text = "Ich heiße Jürgen und wohne in Zürich — groß, oder? 😀";
    const spoken = await tts.synthesize({ text });
    const heard = await stt.transcribe({
      audio: spoken.audio,
      format: spoken.format,
      durationMs: 3000,
    });

    expect(heard.text).toBe(text);
  });

  it("falls back to a stated transcript for audio it did not produce", async () => {
    const stt = createMockSpeechToText();

    const heard = await stt.transcribe({
      audio: audio(),
      format: "webm",
      durationMs: 1000,
    });

    expect(heard.text).toBe(MOCK_TRANSCRIPT);
  });
});

/**
 * Parity. Each row is one malformed request; both the mock and the real
 * transport must refuse it, and the real transport must refuse it before it
 * opens a connection.
 */
describe("a mock refuses everything the real provider refuses", () => {
  const badTranscriptions = [
    ["no audio at all", { audio: new Uint8Array(0), format: "webm", durationMs: 1000 }],
    ["a format nobody records", { audio: audio(), format: "flac", durationMs: 1000 }],
    ["a clip longer than a session", { audio: audio(), format: "webm", durationMs: MAX_AUDIO_MS + 1 }],
    ["no duration", { audio: audio(), format: "webm", durationMs: 0 }],
    ["a fractional duration", { audio: audio(), format: "webm", durationMs: 10.5 }],
    ["a language it does not teach", { audio: audio(), format: "webm", durationMs: 1000, language: "fr" }],
    ["a field nobody declared", { audio: audio(), format: "webm", durationMs: 1000, model: "whisper-1" }],
  ] as const;

  it.each(badTranscriptions)("refuses %s", async (_label, request) => {
    const { stt: real, call } = realProviders();
    const mock = createMockSpeechToText();
    const input = request as never;

    await expect(mock.transcribe(input)).rejects.toThrow();
    await expect(real.transcribe(input)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  const badSyntheses = [
    ["nothing to say", { text: "" }],
    ["more than a turn's worth of text", { text: "a".repeat(4001) }],
    ["a speed nobody could follow", { text: "Hallo", speed: 3 }],
    ["a speed too slow to parse", { text: "Hallo", speed: 0.1 }],
    ["a voice the domain does not name", { text: "Hallo", voice: "shimmer" }],
    ["a format nobody plays", { text: "Hallo", format: "flac" }],
    ["a field nobody declared", { text: "Hallo", model: "tts-1" }],
  ] as const;

  it.each(badSyntheses)("refuses %s", async (_label, request) => {
    const { tts: real, call } = realProviders();
    const mock = createMockTextToSpeech();
    const input = request as never;

    await expect(mock.synthesize(input)).rejects.toThrow();
    await expect(real.synthesize(input)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it("accepts every voice the domain names", async () => {
    const tts = createMockTextToSpeech();

    for (const voice of SPEECH_VOICES) {
      await expect(
        tts.synthesize({ text: "Hallo", voice }),
      ).resolves.toBeDefined();
    }
  });

  it("applies the same defaults the real provider applies", async () => {
    // A mock that defaults differently is a mock that passes a test the real
    // provider would fail.
    const tts = createMockTextToSpeech();
    const stt = createMockSpeechToText();

    await tts.synthesize({ text: "Hallo" });
    await stt.transcribe({ audio: audio(), format: "webm", durationMs: 1000 });

    expect(tts.calls[0]).toMatchObject({
      voice: "tutor_warm",
      speed: 1,
      format: "mp3",
    });
    expect(stt.calls[0]).toMatchObject({ language: "de" });
  });
});
