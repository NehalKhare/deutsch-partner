/**
 * Grading a comprehension answer, without a model.
 *
 * The corpus carries a model answer for every question, and most are short
 * enough that normalized containment is an honest check: "Um sieben Uhr." and
 * "um sieben uhr" are the same answer, and "sieben Uhr" inside it still shows
 * the learner understood. Anything that does not match is *review*, not
 * wrong — free-form German has too many right phrasings for a string compare
 * to be allowed to say "incorrect", so the UI shows the model answer and
 * lets the learner judge.
 */

export type QuizGrade = "correct" | "review";

/** Lowercase, punctuation stripped, whitespace collapsed. Umlauts survive. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:„“"'()\-–—]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function gradeAnswer(learner: string, expected: string): QuizGrade {
  const given = normalizeAnswer(learner);
  const answer = normalizeAnswer(expected);

  if (given.length < 1) return "review";
  if (given === answer) return "correct";

  // Containment needs substance in both directions: "1" inside "Gleis 1" is
  // an answer, a lone "e" inside anything is not.
  if (given.length >= 2 && (answer.includes(given) || given.includes(answer))) {
    return "correct";
  }

  return "review";
}
