/**
 * Normalising German text for hashing, embedding and storage.
 *
 * The rule that matters most here is what is *not* normalised. Umlauts and ß
 * are letters, not decoration: folding ä to ae or ß to ss would change the
 * words, break every match against the lexicon, and teach a learner spellings
 * that are wrong. Case is left alone for the same reason — German capitalises
 * nouns, and lowercasing throws away a grammatical signal.
 *
 * What is normalised is the invisible variation that makes identical text hash
 * differently: composition form, the several spaces that are not a space, and
 * the several dashes that are the same dash.
 */

const DASHES = /[‐‑‒–—―]/gu;

const SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;

const APOSTROPHES = /[‘’ʼ]/gu;

export function normalize(text: string): string {
  return (
    text
      // Precomposed form, so "ä" is one codepoint however the source wrote it.
      // Without this the same word hashes two ways and embeds twice.
      .normalize("NFC")
      .replace(SPACES, " ")
      .replace(DASHES, "–")
      .replace(/…/gu, "...")
      // Apostrophes only. German quotation marks („ “ » «) carry meaning in a
      // dialogue and stay exactly as written.
      .replace(APOSTROPHES, "'")
      .replace(/ {2,}/gu, " ")
  );
}
