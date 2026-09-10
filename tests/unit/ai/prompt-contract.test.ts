import { describe, expect, it } from "vitest";
import { z } from "zod";

import { learningEvaluationSchema } from "@/domain/evaluation";
import { STREAMED_TEXT, describeContract } from "@/lib/ai/prompts/contract";
import { buildOutputContract } from "@/lib/ai/prompts/sections";
import { estimateTokens } from "@/lib/ai/prompts/tokens";

describe("describing a contract", () => {
  it("names every field of the object", () => {
    const text = describeContract(
      z.object({ label: z.string(), score: z.number() }),
    );

    expect(text).toContain("label:");
    expect(text).toContain("score:");
  });

  it("lists the members of a closed set, which is the whole point of one", () => {
    expect(describeContract(z.object({ level: z.enum(["A1", "A2", "B1"]) }))).toContain(
      "A1 | A2 | B1",
    );
  });

  it("states a numeric range", () => {
    expect(describeContract(z.object({ score: z.number().min(0).max(1) }))).toContain(
      "number 0 to 1",
    );
  });

  it("distinguishes an integer from a number", () => {
    const text = describeContract(
      z.object({ count: z.number().int().min(1), ratio: z.number().min(0) }),
    );

    expect(text).toContain("count: integer 1 or more");
    expect(text).toContain("ratio: number 0 or more");
  });

  it("states a string's length cap", () => {
    expect(describeContract(z.object({ note: z.string().max(140) }))).toContain(
      "at most 140 characters",
    );
  });

  it("states an array's cap, so a model that loops knows where to stop", () => {
    expect(describeContract(z.object({ tags: z.array(z.string()).max(5) }))).toContain(
      "array of at most 5",
    );
  });

  it("describes an array's element type", () => {
    expect(
      describeContract(z.object({ levels: z.array(z.enum(["A1", "A2"])).max(3) })),
    ).toContain("[one of: A1 | A2]");
  });

  it("recurses into a nested object", () => {
    const text = describeContract(
      z.object({ skills: z.object({ fluency: z.number().min(0).max(1) }) }),
    );

    expect(text).toContain("skills: { fluency: number 0 to 1 }");
  });

  it("separates nested fields with semicolons, because a field description has commas", () => {
    const text = describeContract(
      z.object({ inner: z.object({ a: z.string().max(10), b: z.string().max(20) }) }),
    );

    expect(text).toContain(
      "inner: { a: string, at most 10 characters; b: string, at most 20 characters }",
    );
  });

  it("says when a field may be omitted", () => {
    expect(describeContract(z.object({ note: z.string().optional() }))).toContain(
      "may be omitted",
    );
  });

  it("says when a field may be null", () => {
    expect(describeContract(z.object({ note: z.string().nullable() }))).toContain(
      "or null",
    );
  });

  it("describes a boolean", () => {
    expect(describeContract(z.object({ done: z.boolean() }))).toContain("true or false");
  });

  it("stops recursing rather than unrolling an arbitrarily deep shape", () => {
    // Seven objects deep. The limit sits at six nesting steps, which is what
    // the deepest real contract needs and one more than any of them has.
    const deep = z.object({
      a: z.object({
        b: z.object({
          c: z.object({ d: z.object({ e: z.object({ f: z.object({ g: z.string() }) }) }) }),
        }),
      }),
    });

    expect(describeContract(deep)).not.toContain("g:");
  });

  it("describes something that is not an object at all", () => {
    expect(describeContract(z.array(z.string()).max(3))).toContain("array of at most 3");
  });

  it("tells the model to return the object and nothing else", () => {
    // A model that returns the right shape wrapped in an explanation is a
    // model whose output has to be dug out of prose.
    const text = describeContract(z.object({ label: z.string() }));

    expect(text).toMatch(/nothing else/i);
    expect(text).toMatch(/no code fence/i);
  });
});

describe("nested shapes", () => {
  it("names the fields of an object inside a list inside a wrapped list", () => {
    // The market-research shape: a wrapper object, a list of findings, each
    // carrying a list of evidence objects. At a depth limit of four the
    // innermost object rendered as a bare "object", and the model, told
    // nothing about its fields, invented one — every reply then failed
    // validation on the same key.
    const contract = describeContract(
      z.strictObject({
        findings: z.array(
          z.strictObject({
            title: z.string(),
            evidence: z.array(z.strictObject({ url: z.string(), finding: z.string() })).max(2),
          }),
        ),
      }),
    );

    expect(contract).toContain("finding: string");
    expect(contract).not.toMatch(/\[object\]/);
  });
});

describe("the contract cannot drift from the validator", () => {
  it("is generated from the schema that will do the validating", () => {
    // The property that matters: a change to the schema shows up in the text.
    const before = describeContract(z.object({ tags: z.array(z.string()).max(5) }));
    const after = describeContract(z.object({ tags: z.array(z.string()).max(50) }));

    expect(before).not.toBe(after);
  });

  it("mentions every field the evaluation schema requires", () => {
    const text = describeContract(learningEvaluationSchema);

    for (const field of Object.keys(learningEvaluationSchema.shape)) {
      expect(text, field).toContain(`${field}:`);
    }
  });

  it("stays inside the block cap it is budgeted for", () => {
    // The largest contract in the catalogue. If this grows past the cap, a
    // prompt starts arriving with a truncated contract, which is worse than a
    // large one.
    expect(estimateTokens(describeContract(learningEvaluationSchema))).toBeLessThan(600);
  });
});

describe("streamed prose", () => {
  it("has no contract block at all", () => {
    // Its output is prose for a person; the response policy is its shape.
    expect(buildOutputContract(STREAMED_TEXT)).toBeNull();
  });

  it("renders one for anything else", () => {
    expect(buildOutputContract(z.object({ label: z.string() }))).toContain("label:");
  });
});
