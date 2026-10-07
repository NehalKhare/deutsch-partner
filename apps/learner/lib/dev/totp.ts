import { createHmac } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238 over RFC 4226), as an authenticator
 * app computes them: HMAC-SHA1, thirty-second steps, six digits.
 *
 * For the fixture learner only — the seeding script answers its own enrolment
 * with this, and the end-to-end specs answer the sign-in challenge. The
 * application never generates a code; Supabase verifies them. Nothing here
 * is imported by anything a learner's request runs through.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The secret as an authenticator app receives it: base32, case-insensitive, padding optional. */
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[=\s-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`not a base32 secret: ${JSON.stringify(character)}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export interface TotpOptions {
  /** Seconds per code. Thirty, everywhere that matters. */
  readonly stepSeconds?: number;
  readonly digits?: number;
}

/** The code an authenticator shows for a secret at a moment, by default now. */
export function totpCode(
  secret: string,
  atMs: number = Date.now(),
  { stepSeconds = 30, digits = 6 }: TotpOptions = {},
): string {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, "0");
}
