import type { ErrorType } from "@/domain/learner-error";

/**
 * What each mistake category is called when a learner reads it.
 *
 * The error types are a closed set, so the dashboard can headline every
 * recurring mistake in plain English deterministically — including the rows
 * written before the evaluator was told to explain in English, whose stored
 * explanations are German. The label is the part that must never be a slug:
 * "case_dative ×4" is a log line, "The dative case ×4" is teaching.
 */
export const ERROR_TYPE_LABELS: Readonly<Record<ErrorType, string>> = {
  word_order: "Word order",
  gender: "Noun gender (der, die, das)",
  case_nominative: "The nominative case",
  case_accusative: "The accusative case",
  case_dative: "The dative case",
  verb_conjugation: "Verb endings",
  modal_verb: "Modal verbs",
  separable_verb: "Separable verbs",
  perfekt: "The Perfekt tense",
  subordinate_clause: "Subordinate clauses",
  relative_clause: "Relative clauses",
  adjective_ending: "Adjective endings",
  preposition: "Prepositions",
  reflexive_verb: "Reflexive verbs",
  article: "Articles",
  plural_form: "Plural forms",
  vocabulary_choice: "Word choice",
  spelling: "Spelling",
  register_formality: "Formality (du and Sie)",
};
