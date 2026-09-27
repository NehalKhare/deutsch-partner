import { describe, expect, it } from "vitest";

import { TRIAL_DAYS } from "@dp/domain/billing";
import { PLAN_CATALOGUE, PLAN_CODES } from "@dp/domain/plans";
import { tierFor } from "@dp/domain/tasks";

import {
  ALWAYS_FREE,
  COMPARISON_ROWS,
  PLAN_TAGLINES,
  PRICING_FAQ,
  RECOMMENDED_PLAN,
  planHighlights,
  planName,
  tutorModelLabel,
} from "@/lib/billing/copy";

/**
 * What the pricing page says each plan is.
 *
 * Every figure a learner reads about a plan is computed from the catalogue
 * and the routing table the product runs on — so the page cannot promise 200
 * tutor turns while the quota counts 150, or a stronger model than the table
 * routes to. What the copy may not do is pinned too: name a price, sell a
 * feature that is not built as if it were, or say anything that would read as
 * an instruction to a model.
 */

const everyString = (): string[] => [
  ...Object.values(PLAN_TAGLINES),
  ...PLAN_CODES.flatMap((plan) => planHighlights(plan)),
  ...COMPARISON_ROWS.flatMap((row) => [row.label, ...Object.values(row.values).map(String)]),
  ...ALWAYS_FREE,
  ...PRICING_FAQ.flatMap((entry) => [entry.question, entry.answer]),
];

describe("the plans", () => {
  it("are named as the catalogue names them", () => {
    for (const plan of PLAN_CODES) {
      expect(planName(plan)).toBe(PLAN_CATALOGUE[plan].name);
    }
  });

  it("recommend Plus", () => {
    expect(RECOMMENDED_PLAN).toBe("plus");
  });

  it("each have a tagline", () => {
    for (const plan of PLAN_CODES) {
      expect(PLAN_TAGLINES[plan].length).toBeGreaterThan(10);
    }
  });
});

describe("the tutor model", () => {
  it("is described from the tier the routing table gives each plan", () => {
    // Same tier, same words; a different tier, different words.
    expect(tierFor("conversation.turn", "plus")).toBe(tierFor("conversation.turn", "premium"));
    expect(tutorModelLabel("plus")).toBe(tutorModelLabel("premium"));
    expect(tierFor("conversation.turn", "free")).not.toBe(tierFor("conversation.turn", "plus"));
    expect(tutorModelLabel("free")).not.toBe(tutorModelLabel("plus"));
  });
});

describe("the highlights", () => {
  it("state the daily tutor turns the quota will count", () => {
    for (const plan of PLAN_CODES) {
      const turns = PLAN_CATALOGUE[plan].dailyQuotas.tutor_turns;
      expect(planHighlights(plan).join("\n")).toContain(`${turns} tutor turns a day`);
    }
  });

  it("name the tutor model first", () => {
    for (const plan of PLAN_CODES) {
      expect(planHighlights(plan)[0]).toBe(tutorModelLabel(plan));
    }
  });

  it("give Free the device's own voice and no AI voice", () => {
    const free = planHighlights("free").join("\n");
    expect(free).toMatch(/device/i);
    expect(free).not.toMatch(/AI voice/);
  });

  it("give the paid plans the AI voice lines the quota allows", () => {
    for (const plan of ["plus", "premium"] as const) {
      const lines = PLAN_CATALOGUE[plan].dailyQuotas.voice_lines;
      expect(planHighlights(plan).join("\n")).toContain(`${lines}`);
    }
  });

  it("mark a feature that is not built yet as coming, rather than selling it", () => {
    const premium = planHighlights("premium").join("\n");
    expect(premium).toMatch(/hands-free conversation \(coming soon\)/i);
  });

  it("are four or five lines each, so the cards stay readable", () => {
    for (const plan of PLAN_CODES) {
      expect(planHighlights(plan).length).toBeGreaterThanOrEqual(4);
      expect(planHighlights(plan).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("the comparison", () => {
  it("has a value for every plan in every row", () => {
    for (const row of COMPARISON_ROWS) {
      expect(Object.keys(row.values).sort()).toEqual([...PLAN_CODES].sort());
    }
  });

  it("carries the catalogue's quotas, not its own", () => {
    const row = (label: RegExp) => COMPARISON_ROWS.find((candidate) => label.test(candidate.label))!;
    for (const plan of PLAN_CODES) {
      const quotas = PLAN_CATALOGUE[plan].dailyQuotas;
      expect(row(/tutor turns/i).values[plan]).toBe(String(quotas.tutor_turns));
      expect(row(/trainer requests/i).values[plan]).toBe(String(quotas.trainer_requests));
      expect(row(/spoken answers/i).values[plan]).toBe(String(quotas.transcriptions));
    }
  });

  it("follows the catalogue's features", () => {
    const handsFree = COMPARISON_ROWS.find((row) => /hands-free/i.test(row.label))!;
    for (const plan of PLAN_CODES) {
      expect(handsFree.values[plan]).toBe(PLAN_CATALOGUE[plan].features.handsFreeConversation);
    }
    expect(handsFree.comingSoon).toBe(true);
  });

  it("shows Premium's wider context and nobody else's", () => {
    const context = COMPARISON_ROWS.find((row) => /context/i.test(row.label))!;
    expect(context.values.premium).not.toBe(context.values.plus);
    expect(context.values.free).toBe(context.values.plus);
  });
});

describe("what every plan keeps", () => {
  it("lists what the spec never gates", () => {
    const text = ALWAYS_FREE.join("\n");
    expect(text).toMatch(/review/i);
    expect(text).toMatch(/curriculum/i);
    expect(text).toMatch(/no locked chapters/i);
    expect(text).toMatch(/dashboard/i);
    expect(text).toMatch(/scenario/i);
    expect(text).toMatch(/browser voice|device's own voice/i);
  });
});

describe("the pricing questions", () => {
  const text = PRICING_FAQ.map((entry) => `${entry.question}\n${entry.answer}`).join("\n");

  it("name the payment methods, as offered where Stripe offers them", () => {
    for (const method of ["Visa", "Mastercard", "Apple Pay", "Google Pay", "Klarna", "SEPA Direct Debit", "PayPal"]) {
      expect(text).toContain(method);
    }
    expect(text).toMatch(/where available/i);
  });

  it("say prices include VAT", () => {
    expect(text).toMatch(/include VAT/i);
  });

  it("say how to cancel, and that withdrawal is fourteen days", () => {
    expect(text).toMatch(/cancel any time/i);
    expect(text).toMatch(/14 days/);
  });

  it("say the trial takes no card and charges nothing", () => {
    expect(text).toContain(`${TRIAL_DAYS}-day`);
    expect(text).toMatch(/no card/i);
  });

  it("say a plan never changes how a learner is assessed", () => {
    expect(text).toMatch(/same evaluation/i);
  });
});

describe("all of it", () => {
  it("names no price: those are Stripe's, read at request time", () => {
    for (const line of everyString()) {
      expect(line, line).not.toMatch(/[€$£]|\d+\.\d{2}/);
    }
  });

  it("describes and never instructs", () => {
    for (const line of everyString()) {
      expect(line, line).not.toMatch(/\b(You are|Your task is|Respond only)\b/);
    }
  });
});
