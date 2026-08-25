import { describe, expect, it, vi } from "vitest";

import { FX_SOURCE, fetchEurPerUsd, parseEcbDailyFeed } from "@/lib/ops/fx-source";

/**
 * The euro rate's one named source.
 *
 * The feed is quoted the opposite way round from the way this product bills —
 * dollars per euro, where the ledger wants euro per dollar — so the inversion
 * and the guard around it are the whole of what matters here. A rate that
 * parses to the wrong side of one misprices every call in the same direction,
 * quietly, which is the kind of bug a dashboard cannot show you.
 */

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-08-24'>
      <Cube currency='USD' rate='1.25'/>
      <Cube currency='JPY' rate='185.60'/>
      <Cube currency='GBP' rate='0.85550'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("reading the published feed", () => {
  it("inverts the quote into euro per dollar", () => {
    // A dollar and a quarter to the euro is eighty cents to the dollar.
    expect(parseEcbDailyFeed(FEED)?.eurPerUsd).toBeCloseTo(0.8, 10);
  });

  it("keeps the date the source published, not the date it was read", () => {
    // What makes a carried-forward rate legible on the dashboard: a rate
    // stamped with today would claim to be today's whatever day it was.
    expect(parseEcbDailyFeed(FEED)?.rateDate).toBe("2026-08-24");
  });

  it("names the source on the snapshot", () => {
    expect(parseEcbDailyFeed(FEED)?.source).toBe(FX_SOURCE);
  });

  it("reads the dollar line and not whichever line comes first", () => {
    const reordered = FEED.replace(
      "<Cube currency='USD' rate='1.25'/>",
      "",
    ).replace("<Cube currency='JPY'", "<Cube currency='USD' rate='1.25'/><Cube currency='JPY'");

    expect(parseEcbDailyFeed(reordered)?.eurPerUsd).toBeCloseTo(0.8, 10);
  });

  it("accepts the feed's double-quoted spelling too", () => {
    expect(
      parseEcbDailyFeed(FEED.replaceAll("'", '"'))?.eurPerUsd,
    ).toBeCloseTo(0.8, 10);
  });
});

describe("what it refuses to believe", () => {
  it("returns nothing when the dollar line is absent", () => {
    expect(
      parseEcbDailyFeed(FEED.replace("<Cube currency='USD' rate='1.25'/>", "")),
    ).toBeNull();
  });

  it("returns nothing when the feed carries no date", () => {
    expect(parseEcbDailyFeed(FEED.replace("time='2026-08-24'", ""))).toBeNull();
  });

  it("returns nothing for a quote outside any plausible cross rate", () => {
    // The shape of a misparse: the yen line read as the dollar one. Storing it
    // would underprice every call by two orders of magnitude and fail nothing.
    expect(
      parseEcbDailyFeed(FEED.replace("rate='1.25'", "rate='185.60'")),
    ).toBeNull();
  });

  it("returns nothing for a zero or negative quote", () => {
    expect(parseEcbDailyFeed(FEED.replace("rate='1.25'", "rate='0'"))).toBeNull();
    expect(parseEcbDailyFeed(FEED.replace("rate='1.25'", "rate='x'"))).toBeNull();
  });

  it("returns nothing for an empty document", () => {
    expect(parseEcbDailyFeed("")).toBeNull();
  });
});

describe("fetching it", () => {
  it("asks the source once and parses what came back", async () => {
    const fetchImpl = vi.fn(async () => new Response(FEED, { status: 200 }));

    const snapshot = await fetchEurPerUsd(fetchImpl as unknown as typeof fetch);

    expect(snapshot?.eurPerUsd).toBeCloseTo(0.8, 10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("answers null rather than throwing when the source is unreachable", async () => {
    // A job that cannot reach its source has learned nothing. The reader
    // already knows how to carry the last rate forward and say that it did,
    // and a thrown error here would only turn a quiet day into an outage.
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      fetchEurPerUsd(failing as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("answers null on a refusal from the source", async () => {
    const refusing = vi.fn(async () => new Response("nope", { status: 503 }));

    await expect(
      fetchEurPerUsd(refusing as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("answers null when the source returns something that is not the feed", async () => {
    const wrong = vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 }));

    await expect(fetchEurPerUsd(wrong as unknown as typeof fetch)).resolves.toBeNull();
  });
});
