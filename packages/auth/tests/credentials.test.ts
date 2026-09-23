import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  credentialsSchema,
  signUpSchema,
} from "../src/credentials";

const valid = { email: "lernerin@example.com", password: "korrekt-pferd-42" };

describe("credentialsSchema", () => {
  it("accepts a valid email and password", () => {
    expect(credentialsSchema.parse(valid).email).toBe("lernerin@example.com");
  });

  it("normalises the email so casing cannot create a second account", () => {
    expect(
      credentialsSchema.parse({ ...valid, email: "  Lernerin@Example.COM " })
        .email,
    ).toBe("lernerin@example.com");
  });

  it.each(["not-an-email", "", "a@", "@b.com"])("rejects %o", (email) => {
    expect(credentialsSchema.safeParse({ ...valid, email }).success).toBe(false);
  });

  it("rejects a password below the minimum length", () => {
    expect(
      credentialsSchema.safeParse({
        ...valid,
        password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
      }).success,
    ).toBe(false);
  });

  it("accepts a password at exactly the minimum length", () => {
    expect(
      credentialsSchema.safeParse({
        ...valid,
        password: "a".repeat(MIN_PASSWORD_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("caps password length, since a megabyte of input is an attack not a password", () => {
    expect(
      credentialsSchema.safeParse({ ...valid, password: "a".repeat(10_000) })
        .success,
    ).toBe(false);
  });

  it("does not trim the password, because spaces may be deliberate", () => {
    const parsed = credentialsSchema.parse({ ...valid, password: " leading-space" });

    expect(parsed.password).toBe(" leading-space");
  });
});

describe("signUpSchema", () => {
  it("requires the learner to confirm their password", () => {
    expect(
      signUpSchema.safeParse({ ...valid, confirmPassword: "different-entirely" })
        .success,
    ).toBe(false);
  });

  it("accepts a matching confirmation", () => {
    expect(
      signUpSchema.safeParse({ ...valid, confirmPassword: valid.password })
        .success,
    ).toBe(true);
  });

  it("reports the mismatch against the confirmation field", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: "different-entirely",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});
