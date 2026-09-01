/**
 * Human-readable names for the culture-note slugs the curriculum targets.
 *
 * The counterpart of GRAMMAR_LABELS, kept apart from it because the two key
 * spaces share one database table and a collision would abort the seed. The
 * slug is the join key to grammar_patterns.key; the label is what a learner
 * reads, phrased to drop into the middle of a sentence.
 */
export const CULTURE_LABELS: Readonly<Record<string, string>> = {
  // --- A1 ---
  du_oder_sie: "the choice between du and Sie",
  bitte_und_danke: "the three jobs of bitte",
  fremde_ansprechen: "the polite way to address strangers",
  wie_gehts_unter_freunden: "Wie geht es dir as a real question",
  // --- A2 ---
  puenktlichkeit_und_absagen: "punctuality and cancelling politely",
  schriftliche_anrede: "the formal salutations in writing",
  reklamieren_mit_stil: "the firm but polite complaint",
  duzen_anbieten: "the offer of the du",
  smalltalk_themen: "small-talk topics and taboos",
  // --- B1 ---
  bitten_abschwaechen: "softening a request",
  sie_und_du_im_beruf: "formality at work",
  vorstellungsgespraech_umgangsformen: "the interview conventions",
  amtssprache: "the register at the Behörde",
  direktheit_verstehen: "directness without rudeness",
  regionale_gruesse: "the regional greetings",
};
